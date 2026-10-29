/* ==========================================================================
   Django bridge for the Python Form Designer.

   The visual designer itself is the original standalone script (inline in the
   template).  This file wires it to the Django backend:
     * save / auto-save the form to the user's account
     * share links + per-user sharing
     * per-form chat drawer
     * read-only mode for shared / public links
   ========================================================================== */
(function () {
    'use strict';

    const bootstrapEl = document.getElementById('app-bootstrap');
    if (!bootstrapEl) {
        return;
    }
    const cfg = JSON.parse(bootstrapEl.textContent);
    const api = cfg.api;
    const urls = cfg.urls;

    const state = {
        projectId: cfg.project ? cfg.project.id : null,
        projectName: cfg.project ? cfg.project.name : '',
        canEdit: cfg.project ? !!cfg.project.canEdit : true,
        isOwner: cfg.project ? !!cfg.project.isOwner : false,
        shareToken: cfg.project ? cfg.project.shareToken : null,
        shareUrl: cfg.project ? cfg.project.shareUrl : '',
        isPublic: cfg.project ? !!cfg.project.isPublic : false,
        allowCopy: cfg.project ? !!cfg.project.allowCopy : true,
        lastSnapshot: null,
        saving: false,
        chat: null,
        unread: 0,
        chatOpen: false
    };

    const AUTOSAVE_MS = 20000;
    const DRAFT_PREFIX = 'pfd_draft_';

    /* ---------------------------------------------------------------- utils */
    function csrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    async function apiRequest(url, options) {
        const opts = Object.assign({ headers: {} }, options || {});
        opts.headers = Object.assign({ 'X-CSRFToken': csrfToken() }, opts.headers);
        if (opts.body && typeof opts.body !== 'string') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        const response = await fetch(url, opts);
        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            payload = null;
        }
        if (!response.ok || !payload || payload.ok === false) {
            const message = (payload && payload.error) || 'Request failed (' + response.status + ')';
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function toast(message, kind) {
        const stack = document.getElementById('toastStack') || document.body;
        const node = document.createElement('div');
        node.className = 'toast' + (kind ? ' ' + kind : '');
        node.textContent = message;
        stack.appendChild(node);
        requestAnimationFrame(function () {
            node.classList.add('show');
        });
        setTimeout(function () {
            node.classList.remove('show');
            setTimeout(function () {
                node.remove();
            }, 250);
        }, 3000);
    }

    function setStatus(text, stateName) {
        const wrapper = document.getElementById('saveStatus');
        const label = document.getElementById('saveStatusText');
        if (label) label.textContent = text;
        if (wrapper) wrapper.dataset.state = stateName || 'idle';
        const statusSave = document.getElementById('statusSave');
        if (statusSave) statusSave.textContent = text;
    }

    function updateChip(name) {
        const chip = document.getElementById('projectChip');
        if (chip) chip.textContent = name || 'Unsaved form';
        const statusFile = document.getElementById('statusFile');
        if (statusFile) statusFile.textContent = (name || 'Untitled') + '.py';
        const drawerTitle = document.getElementById('chatDrawerTitle');
        if (drawerTitle) drawerTitle.textContent = name ? 'Chat: ' + name : 'Form chat';
    }

    function currentName() {
        const input = document.getElementById('propName');
        return (input && input.value.trim()) || state.projectName || 'Untitled form';
    }

    function currentData() {
        if (typeof window.pfdGetProjectData !== 'function') {
            return null;
        }
        return window.pfdGetProjectData(currentName());
    }

    function currentCode() {
        const pre = document.getElementById('codePreviewContent');
        return pre ? pre.textContent : '';
    }

    // Timestamps change on every call, so leave them out when comparing.
    function snapshot(data) {
        if (!data) return '';
        return JSON.stringify({
            fileName: data.fileName,
            formStructure: data.formStructure,
            controls: data.controls,
            eventHandlers: data.eventHandlers,
            visualLogic: data.visualLogic
        });
    }

    function isDirty() {
        if (!state.lastSnapshot) return false;
        return snapshot(currentData()) !== state.lastSnapshot;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            const input = document.createElement('textarea');
            input.value = text;
            document.body.appendChild(input);
            input.select();
            const ok = document.execCommand('copy');
            input.remove();
            return ok;
        }
    }

    /* ------------------------------------------------------------ save/load */
    function buildPayload() {
        const data = currentData();
        return {
            name: (data && data.formStructure && data.formStructure.name) || currentName(),
            data: data || {},
            python_code: currentCode()
        };
    }

    async function saveToServer(options) {
        const opts = options || {};
        if (!state.canEdit) {
            toast('You only have read-only access to this form.', 'error');
            return;
        }
        if (state.saving) return;
        if (typeof window.pfdGetProjectData !== 'function') {
            toast('The designer is still loading - try again in a second.', 'error');
            return;
        }

        state.saving = true;
        setStatus('Saving...', 'saving');
        const payload = buildPayload();

        try {
            let project;
            if (state.projectId) {
                const response = await apiRequest(
                    api.projectTemplate.replace('__ID__', state.projectId),
                    { method: 'PATCH', body: payload }
                );
                project = response.project;
            } else {
                const response = await apiRequest(api.projects, { method: 'POST', body: payload });
                project = response.project;
                state.projectId = project.id;
                state.isOwner = true;
                state.canEdit = true;
                state.shareToken = project.share_token;
                state.shareUrl = project.share_url;
                window.history.replaceState(null, '', urls.projectTemplate.replace('__ID__', project.id));
                const shareBtn = document.getElementById('shareBtn');
                if (shareBtn) shareBtn.disabled = false;
                startChat();
            }

            state.projectName = project.name;
            state.isPublic = !!project.is_public;
            state.allowCopy = !!project.allow_copy;
            if (project.share_url) state.shareUrl = project.share_url;
            state.lastSnapshot = snapshot(payload.data);
            updateChip(project.name);
            setStatus('Saved to your account', 'saved');
            if (!opts.silent) {
                toast('Saved "' + project.name + '" to your account', 'success');
            }
        } catch (err) {
            setStatus('Save failed', 'error');
            toast(err.message, 'error');
        } finally {
            state.saving = false;
        }
    }

    /* ----------------------------------------------------------- read-only */
    function enterReadOnlyMode() {
        document.body.classList.add('pfd-read-only');
        const saveBtn = document.getElementById('saveToAccountBtn');
        if (saveBtn) saveBtn.remove();
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) shareBtn.remove();
        const localSaveBtn = document.getElementById('localSaveBtn');
        if (localSaveBtn) localSaveBtn.remove();
        setStatus('Read-only shared form', 'idle');
        const download = document.getElementById('downloadPyLink');
        if (download) {
            download.href = urls.downloadPythonShared.replace('__TOKEN__', state.shareToken || '');
        }
    }

    /* ---------------------------------------------------------------- chat */
    function startChat() {
        const container = document.getElementById('chatDrawerBody');
        if (!container || !state.projectId || !window.FormDesignerChat) return;

        if (state.chat && state.chat.stop) state.chat.stop();
        state.chat = window.FormDesignerChat.create({
            url: api.chatTemplate.replace('__ID__', state.projectId),
            container: container,
            canPost: !!cfg.user.isAuthenticated,
            loginUrl: urls.login,
            emptyText: 'No messages in this form chat yet.',
            onMessages: function (messages) {
                if (state.chatOpen) return;
                state.unread += messages.length;
                const badge = document.getElementById('chatBadge');
                if (badge) {
                    badge.hidden = false;
                    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
                }
            },
            onError: function (message) {
                toast(message, 'error');
            }
        });
    }

    function openChatDrawer() {
        const drawer = document.getElementById('chatDrawer');
        if (!drawer) return;
        if (!state.projectId) {
            toast('Save this form to your account first - then you can chat about it.', 'error');
            return;
        }
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        state.chatOpen = true;
        state.unread = 0;
        const badge = document.getElementById('chatBadge');
        if (badge) badge.hidden = true;
    }

    /* --------------------------------------------------------------- share */
    function applyProjectMeta(project) {
        if (!project) return;
        state.projectName = project.name;
        state.isPublic = !!project.is_public;
        state.allowCopy = !!project.allow_copy;
        if (project.share_token) state.shareToken = project.share_token;
        if (project.share_url) state.shareUrl = project.share_url;
        if (typeof project.can_edit === 'boolean') state.canEdit = project.can_edit;
        if (typeof project.is_owner === 'boolean') state.isOwner = project.is_owner;
        state.shares = project.shares || [];
        updateChip(project.name);
    }

    function renderShare() {
        const note = document.getElementById('shareNotSavedNote');
        const controls = document.getElementById('shareControls');
        const linkInput = document.getElementById('shareLinkInput');
        const publicToggle = document.getElementById('sharePublicToggle');
        const copyToggle = document.getElementById('shareCopyToggle');
        const list = document.getElementById('shareList');

        if (!state.projectId) {
            if (note) note.hidden = false;
            if (controls) controls.hidden = true;
            return;
        }
        if (note) note.hidden = true;
        if (controls) controls.hidden = false;
        if (linkInput) linkInput.value = state.shareUrl || '';
        if (publicToggle) publicToggle.checked = !!state.isPublic;
        if (copyToggle) copyToggle.checked = !!state.allowCopy;

        if (!list) return;
        list.innerHTML = '';
        const shares = state.shares || [];
        if (!shares.length) {
            const empty = document.createElement('li');
            empty.style.background = 'transparent';
            empty.style.color = '#95a5a6';
            empty.textContent = 'Not shared with any registered user yet.';
            list.appendChild(empty);
            return;
        }
        shares.forEach(function (share) {
            const item = document.createElement('li');
            const name = document.createElement('span');
            name.className = 'grow';
            name.textContent = share.username;
            const flag = document.createElement('span');
            flag.className = 'share-edit-flag';
            flag.textContent = share.can_edit ? 'can edit' : 'view only';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-danger btn-sm';
            remove.dataset.username = share.username;
            remove.innerHTML = '<i class="fas fa-user-minus"></i>';
            remove.title = 'Remove access';
            item.appendChild(name);
            item.appendChild(flag);
            item.appendChild(remove);
            list.appendChild(item);
        });
    }

    async function shareAction(payload) {
        const response = await apiRequest(api.shareTemplate.replace('__ID__', state.projectId), {
            method: 'POST',
            body: payload
        });
        applyProjectMeta(response.project);
        renderShare();
        return response;
    }

    async function openShareModal() {
        const modal = document.getElementById('shareModal');
        if (!modal) return;
        modal.classList.add('open');
        renderShare();
        if (!state.projectId) return;
        try {
            const response = await apiRequest(api.projectTemplate.replace('__ID__', state.projectId), {
                method: 'GET'
            });
            applyProjectMeta(response.project);
            renderShare();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    function closeShareModal() {
        const modal = document.getElementById('shareModal');
        if (modal) modal.classList.remove('open');
    }

    async function copyToMyAccount() {
        if (!state.shareToken) return;
        try {
            const response = await apiRequest(
                api.importSharedTemplate.replace('__TOKEN__', state.shareToken),
                { method: 'POST' }
            );
            toast('Copied to your account', 'success');
            window.location.href = response.project.url;
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    /* -------------------------------------------------------- browser draft */
    function draftKey() {
        return DRAFT_PREFIX + (state.projectId || 'new');
    }

    function saveDraft(silent) {
        const data = currentData();
        if (!data) return;
        try {
            localStorage.setItem(
                draftKey(),
                JSON.stringify({ savedAt: new Date().toISOString(), data: data })
            );
            if (!silent) {
                toast('Draft saved in this browser', 'success');
                setStatus('Draft saved in this browser', 'dirty');
            }
        } catch (err) {
            if (!silent) toast('Could not save a browser draft (storage full?)', 'error');
        }
    }

    function readDraft() {
        try {
            const raw = localStorage.getItem(draftKey());
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function closeChatDrawer() {
        const drawer = document.getElementById('chatDrawer');
        if (!drawer) return;
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        state.chatOpen = false;
    }

    /* ------------------------------------------------------------ wiring up */
    function on(id, event, handler) {
        const element = document.getElementById(id);
        if (element) element.addEventListener(event, handler);
    }

    function wireEvents() {
        on('saveToAccountBtn', 'click', function () {
            saveToServer();
        });

        on('localSaveBtn', 'click', function () {
            const modal = document.getElementById('saveModal');
            if (modal) {
                modal.style.display = 'flex';
            } else {
                saveDraft(false);
            }
        });

        on('shareBtn', 'click', openShareModal);
        on('shareModalClose', 'click', closeShareModal);
        on('shareDoneBtn', 'click', closeShareModal);

        const backdrop = document.getElementById('shareModal');
        if (backdrop) {
            backdrop.addEventListener('click', function (event) {
                if (event.target === backdrop) closeShareModal();
            });
        }

        on('copyShareLinkBtn', 'click', async function () {
            const input = document.getElementById('shareLinkInput');
            if (!input || !input.value) return;
            const ok = await copyText(input.value);
            toast(ok ? 'Share link copied' : 'Could not copy the link', ok ? 'success' : 'error');
        });

        on('sharePublicToggle', 'change', function (event) {
            shareAction({
                action: 'visibility',
                is_public: event.target.checked,
                allow_copy: state.allowCopy
            }).catch(function (err) {
                toast(err.message, 'error');
            });
        });

        on('shareCopyToggle', 'change', function (event) {
            shareAction({
                action: 'visibility',
                is_public: state.isPublic,
                allow_copy: event.target.checked
            }).catch(function (err) {
                toast(err.message, 'error');
            });
        });

        on('shareAddBtn', 'click', async function () {
            const usernameInput = document.getElementById('shareUsername');
            const canEditInput = document.getElementById('shareCanEdit');
            const username = usernameInput ? usernameInput.value.trim() : '';
            if (!username) {
                toast('Enter a username to share with.', 'error');
                return;
            }
            try {
                await shareAction({
                    action: 'share',
                    username: username,
                    can_edit: !!(canEditInput && canEditInput.checked)
                });
                if (usernameInput) usernameInput.value = '';
                if (canEditInput) canEditInput.checked = false;
                toast('Shared with ' + username, 'success');
            } catch (err) {
                toast(err.message, 'error');
            }
        });

        on('shareRegenerateBtn', 'click', async function () {
            if (!window.confirm('Create a new link? The old link will stop working.')) return;
            try {
                await shareAction({ action: 'regenerate' });
                toast('A new share link was created', 'success');
            } catch (err) {
                toast(err.message, 'error');
            }
        });

        const shareList = document.getElementById('shareList');
        if (shareList) {
            shareList.addEventListener('click', async function (event) {
                const button = event.target.closest('button[data-username]');
                if (!button) return;
                try {
                    await shareAction({ action: 'unshare', username: button.dataset.username });
                    toast('Removed access for ' + button.dataset.username, 'success');
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        }

        on('copyToAccountBtn', 'click', copyToMyAccount);
        on('chatBtn', 'click', openChatDrawer);
        on('chatDrawerClose', 'click', closeChatDrawer);

        document.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveToServer();
            }
        });

        window.addEventListener('beforeunload', function (event) {
            if (state.canEdit && isDirty()) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    }

    function startAutosave() {
        if (!state.canEdit) return;
        setInterval(function () {
            if (state.saving) return;
            if (state.projectId) {
                if (isDirty()) {
                    setStatus('Unsaved changes - auto-saving...', 'dirty');
                    saveToServer({ silent: true });
                }
            } else {
                saveDraft(true);
            }
        }, AUTOSAVE_MS);
    }

    let initialised = false;

    function init() {
        if (initialised) return;
        initialised = true;

        if (cfg.project && cfg.project.data && typeof window.applyFormData === 'function') {
            window.applyFormData(cfg.project.data);
            state.lastSnapshot = snapshot(cfg.project.data);
            setStatus('Loaded from your account', 'saved');
        }

        // Read-only mode wins over the load status message.
        if (cfg.readOnly) {
            enterReadOnlyMode();
        }

        updateChip(state.projectName);
        wireEvents();

        if (state.projectId) {
            startChat();
        } else if (!cfg.readOnly) {
            const draft = readDraft();
            const controls = draft && draft.data && draft.data.controls ? draft.data.controls : [];
            if (controls.length) {
                const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'earlier';
                if (window.confirm('A browser draft saved ' + when + ' was found. Restore it?')) {
                    window.applyFormData(draft.data);
                    state.lastSnapshot = null;
                    setStatus('Restored browser draft', 'dirty');
                }
            }
        }

        startAutosave();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();




