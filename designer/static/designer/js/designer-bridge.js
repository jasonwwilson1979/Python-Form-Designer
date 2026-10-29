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
        const input = document.getElementById('projectNameInput');
        // Never blank the field - an empty name means "keep what is there".
        if (input && name && document.activeElement !== input) {
            input.value = name;
        }
        const statusFile = document.getElementById('statusFile');
        if (statusFile) statusFile.textContent = (name || 'Untitled') + '.py';
        const drawerTitle = document.getElementById('chatDrawerTitle');
        if (drawerTitle) drawerTitle.textContent = name ? 'Chat: ' + name : 'Form chat';
    }

    // The name the form is saved under. It lives in its own header field so it
    // never changes just because a control was clicked.
    function projectNameValue() {
        const input = document.getElementById('projectNameInput');
        return input ? input.value.trim() : '';
    }

    function currentName() {
        const formProps = typeof window.pfdGetFormProperties === 'function'
            ? window.pfdGetFormProperties()
            : null;
        return projectNameValue() ||
            state.projectName ||
            (formProps && formProps.name) ||
            'Untitled form';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
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
            name: projectNameValue() ||
                (data && data.formStructure && data.formStructure.name) ||
                'Untitled form',
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

    /* --------------------------------------------------------- code library */
    function openCodeLibrary() {
        // The designer owns the modal; clicking its toolbar entry renders the
        // local (browser) snippets list (and the listener below loads the
        // public library).
        const trigger = document.querySelector('.toolbar-item[title="Code Library"]');
        if (trigger) {
            trigger.click();
            return;
        }
        const modal = document.getElementById('codeLibraryModal');
        if (modal) modal.style.display = 'flex';
        loadPublicSnippets();
    }

    function localSnippets() {
        try {
            return JSON.parse(localStorage.getItem('codeSnippets') || '[]');
        } catch (err) {
            return [];
        }
    }

    function saveLocalSnippets(snippets) {
        localStorage.setItem('codeSnippets', JSON.stringify(snippets));
        if (typeof window.pfdRefreshSnippetList === 'function') {
            window.pfdRefreshSnippetList();
        }
    }

    /* ------------------------------------------------- library tabs/search */
    function librarySearchTerm() {
        const input = document.getElementById('codeLibraryModalSearch');
        return input ? input.value.trim() : '';
    }

    function snippetMatches(snippet) {
        const term = librarySearchTerm().toLowerCase();
        if (!term) return true;
        const haystack = [snippet.name, snippet.description, snippet.code]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return haystack.includes(term);
    }

    function setLibraryTab(name) {
        state.libraryTab = name;
        [['mine', 'libraryTabMine', 'libraryPaneMine'],
         ['public', 'libraryTabPublic', 'libraryPanePublic']].forEach(function (row) {
            const active = row[0] === name;
            const tab = document.getElementById(row[1]);
            const pane = document.getElementById(row[2]);
            if (tab) {
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
            }
            if (pane) {
                pane.classList.toggle('active', active);
            }
        });
        updateLibraryCounts();
    }

    function updateLibraryCounts() {
        const term = librarySearchTerm();
        const local = localSnippets();
        const localMatches = local.filter(snippetMatches);
        const publicSnippets = state.snippets || [];
        const publicMatches = publicSnippets.filter(snippetMatches);

        const mineCount = document.getElementById('libraryCountMine');
        if (mineCount) mineCount.textContent = String(localMatches.length);
        const publicCount = document.getElementById('libraryCountPublic');
        if (publicCount) publicCount.textContent = String(publicMatches.length);

        const footer = document.getElementById('libraryFooterHint');
        if (footer) {
            footer.textContent = local.length + ' in this browser - ' +
                publicSnippets.length + ' published' +
                (term ? ' - filtered by "' + term + '"' : '');
        }
    }

    async function loadPublicSnippets() {
        const list = document.getElementById('publicSnippetList');
        if (!list) return;
        try {
            const payload = await apiRequest(api.snippets, { method: 'GET' });
            state.snippets = payload.snippets || [];
            state.canPublish = !!payload.can_publish;
            renderPublicSnippets();
            populatePublishSource();
            const panel = document.getElementById('publishSnippetPanel');
            if (panel) panel.hidden = !state.canPublish;
            const hint = document.getElementById('publicLibraryHint');
            if (hint) {
                hint.textContent = state.canPublish
                    ? 'You can publish, edit and remove shared snippets (administrator)'
                    : 'Shared snippets published by administrators - copy any of them into your own library';
            }

            if (!state.libraryInitialised) {
                state.libraryInitialised = true;
                // Start on the public tab when there is nothing local yet
                const hasLocal = localSnippets().length > 0;
                setLibraryTab(!hasLocal && (state.snippets || []).length ? 'public' : 'mine');
            } else {
                setLibraryTab(state.libraryTab || 'mine');
            }
        } catch (err) {
            list.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
        }
    }

    function renderPublicSnippets() {
        const list = document.getElementById('publicSnippetList');
        if (!list) return;
        const term = librarySearchTerm();
        const snippets = (state.snippets || []).filter(snippetMatches);
        list.innerHTML = '';

        if (!snippets.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = term
                ? 'No public snippets match "' + term + '".'
                : 'No public snippets have been published yet.';
            list.appendChild(empty);
            return;
        }

        snippets.forEach(function (snippet) {
            const item = document.createElement('div');
            item.className = 'public-snippet';

            const head = document.createElement('div');
            head.className = 'public-snippet-head';
            const title = document.createElement('strong');
            title.textContent = snippet.name;
            const meta = document.createElement('span');
            meta.className = 'public-snippet-meta';
            meta.textContent = 'by ' + snippet.created_by +
                (snippet.is_public ? '' : ' - draft') +
                ' - ' + snippet.copy_count + ' copy' + (snippet.copy_count === 1 ? '' : 'ies');
            head.appendChild(title);
            head.appendChild(meta);

            const description = document.createElement('div');
            description.className = 'public-snippet-description';
            description.textContent = snippet.description || '';

            const codeWrap = document.createElement('details');
            codeWrap.className = 'public-snippet-code-wrap';
            const codeSummary = document.createElement('summary');
            codeSummary.textContent = 'Show code';
            const pre = document.createElement('pre');
            pre.className = 'public-snippet-code';
            pre.textContent = snippet.code;
            codeWrap.appendChild(codeSummary);
            codeWrap.appendChild(pre);

            const actions = document.createElement('div');
            actions.className = 'public-snippet-actions';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn btn-primary btn-sm';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy to my library';
            copyBtn.addEventListener('click', function () {
                copyPublicSnippet(snippet);
            });
            actions.appendChild(copyBtn);

            const codeBtn = document.createElement('button');
            codeBtn.type = 'button';
            codeBtn.className = 'btn btn-ghost btn-sm';
            codeBtn.innerHTML = '<i class="fas fa-clipboard"></i> Copy code';
            codeBtn.addEventListener('click', async function () {
                const ok = await copyText(snippet.code);
                toast(ok ? 'Snippet code copied' : 'Could not copy the snippet', ok ? 'success' : 'error');
            });
            actions.appendChild(codeBtn);

            if (snippet.can_edit) {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn btn-ghost btn-sm';
                editBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
                editBtn.addEventListener('click', function () {
                    fillPublishForm(snippet);
                });
                actions.appendChild(editBtn);

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn btn-danger btn-sm';
                removeBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                removeBtn.title = 'Remove from the public library';
                removeBtn.addEventListener('click', async function () {
                    if (!window.confirm('Remove "' + snippet.name + '" from the public library?')) return;
                    try {
                        await apiRequest(api.snippetTemplate.replace('__ID__', snippet.id), { method: 'DELETE' });
                        toast('Snippet removed from the public library', 'success');
                        loadPublicSnippets();
                    } catch (err) {
                        toast(err.message, 'error');
                    }
                });
                actions.appendChild(removeBtn);
            }

            item.appendChild(head);
            if (description.textContent) item.appendChild(description);
            item.appendChild(codeWrap);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    async function copyPublicSnippet(snippet) {
        try {
            const payload = await apiRequest(
                api.snippetCopyTemplate.replace('__ID__', snippet.id),
                { method: 'POST' }
            );
            const fresh = payload.snippet || snippet;
            const snippets = localSnippets();
            const existing = snippets.findIndex(function (entry) {
                return entry.name === fresh.name;
            });
            if (existing >= 0 && !window.confirm('You already have a snippet named "' + fresh.name + '". Replace it?')) {
                return;
            }
            const entry = {
                name: fresh.name,
                description: fresh.description || '',
                code: fresh.code
            };
            if (existing >= 0) {
                snippets[existing] = entry;
            } else {
                snippets.push(entry);
            }
            saveLocalSnippets(snippets);
            toast('"' + fresh.name + '" copied into your library', 'success');
            loadPublicSnippets();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    function populatePublishSource() {
        const select = document.getElementById('publishSnippetSource');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">&mdash; choose one of my snippets &mdash;</option>';
        localSnippets().forEach(function (snippet, index) {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = snippet.name;
            select.appendChild(option);
        });
        select.value = current;
    }

    function fillPublishForm(snippet) {
        const name = document.getElementById('publishSnippetName');
        const description = document.getElementById('publishSnippetDescription');
        const code = document.getElementById('publishSnippetCode');
        const status = document.getElementById('publishSnippetStatus');
        if (name) name.value = snippet.name || '';
        if (description) description.value = snippet.description || '';
        if (code) code.value = snippet.code || '';
        state.editingSnippetId = snippet.id || null;
        if (status) {
            status.textContent = snippet.id ? 'Editing public snippet #' + snippet.id : '';
        }
        const panel = document.getElementById('publishSnippetPanel');
        if (panel) panel.hidden = false;
        if (name) name.focus();
    }

    async function publishSnippet() {
        const name = document.getElementById('publishSnippetName');
        const description = document.getElementById('publishSnippetDescription');
        const code = document.getElementById('publishSnippetCode');
        const status = document.getElementById('publishSnippetStatus');
        if (!name || !code) return;

        const payload = {
            name: name.value.trim(),
            description: description ? description.value.trim() : '',
            code: code.value,
            is_public: true
        };
        if (!payload.name || !payload.code.trim()) {
            if (status) status.textContent = 'Name and code are both required.';
            return;
        }

        try {
            if (state.editingSnippetId) {
                await apiRequest(api.snippetTemplate.replace('__ID__', state.editingSnippetId), {
                    method: 'PATCH',
                    body: payload
                });
            } else {
                await apiRequest(api.snippets, { method: 'POST', body: payload });
            }
            if (status) status.textContent = 'Published.';
            state.editingSnippetId = null;
            name.value = '';
            if (description) description.value = '';
            code.value = '';
            toast('Snippet published to the public library', 'success');
            loadPublicSnippets();
        } catch (err) {
            if (status) status.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    /* -------------------------------------- logic builder public snippets */
    function logicBuilderList() {
        return document.getElementById('codeLibraryPublicList');
    }

    function logicBuilderSearchTerm() {
        const input = document.getElementById('codeLibrarySearch');
        return input ? input.value.trim().toLowerCase() : '';
    }

    async function loadLogicBuilderSnippets() {
        const list = logicBuilderList();
        if (!list) return;
        try {
            const payload = await apiRequest(api.snippets, { method: 'GET' });
            state.snippets = payload.snippets || [];
            state.canPublish = !!payload.can_publish;
        } catch (err) {
            list.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
            return;
        }
        renderLogicBuilderSnippets();
    }

    function renderLogicBuilderSnippets() {
        const list = logicBuilderList();
        if (!list) return;
        const term = logicBuilderSearchTerm();
        const snippets = (state.snippets || []).filter(function (snippet) {
            if (!term) return true;
            return [snippet.name, snippet.description, snippet.code]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(term);
        });

        const badge = document.getElementById('logicLibraryPublicCount');
        if (badge) badge.textContent = String(snippets.length);

        list.innerHTML = '';
        if (!snippets.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = term
                ? 'No public snippets match "' + term + '".'
                : 'No public snippets have been published yet.';
            list.appendChild(empty);
            return;
        }

        snippets.forEach(function (snippet) {
            const item = document.createElement('div');
            item.className = 'code-snippet-item';
            item.style.cssText = 'border-bottom: 1px solid #eee; padding: 8px 0; ' +
                'display: flex; justify-content: space-between; align-items: center; gap: 8px;';

            const info = document.createElement('div');
            info.style.cssText = 'flex: 1; min-width: 0;';
            info.innerHTML =
                '<strong>' + escapeHtml(snippet.name) + '</strong>' +
                (snippet.description
                    ? '<div style="font-size: 11px; color: #888; margin-top: 2px;">' +
                        escapeHtml(snippet.description) + '</div>'
                    : '') +
                '<small style="color: #666; font-family: Consolas, monospace; font-size: 12px; ' +
                    'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; margin-top: 3px;">' +
                    escapeHtml((snippet.code || '').substring(0, 100)) +
                    ((snippet.code || '').length > 100 ? '...' : '') +
                '</small>' +
                '<small style="color: #95a5a6; font-size: 11px;">by ' + escapeHtml(snippet.created_by) +
                    ' - ' + snippet.copy_count + ' cop' + (snippet.copy_count === 1 ? 'y' : 'ies') + '</small>';

            const actions = document.createElement('div');
            actions.style.whiteSpace = 'nowrap';

            const insertButton = document.createElement('button');
            insertButton.type = 'button';
            insertButton.className = 'btn btn-primary';
            insertButton.style.cssText = 'padding: 4px 8px; font-size: 12px; margin-right: 5px;';
            insertButton.textContent = 'Insert';
            insertButton.addEventListener('click', function () {
                insertSnippetIntoEditor(snippet);
            });
            actions.appendChild(insertButton);

            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'btn btn-secondary';
            copyButton.style.cssText = 'padding: 4px 8px; font-size: 12px;';
            copyButton.textContent = 'Copy to my library';
            copyButton.addEventListener('click', function () {
                copySnippetToLocalLibrary(snippet);
            });
            actions.appendChild(copyButton);

            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    function insertSnippetIntoEditor(snippet) {
        if (typeof window.pfdInsertSnippetCode === 'function') {
            window.pfdInsertSnippetCode(snippet.name, snippet.description, snippet.code);
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(snippet.code).catch(function () {});
        }
        toast('Snippet code copied', 'success');
    }

    async function copySnippetToLocalLibrary(snippet) {
        try {
            const payload = await apiRequest(
                api.snippetCopyTemplate.replace('__ID__', snippet.id),
                { method: 'POST' }
            );
            const fresh = payload.snippet || snippet;
            const snippets = localSnippets();
            const existing = snippets.findIndex(function (entry) {
                return entry.name === fresh.name;
            });
            if (existing >= 0 && !window.confirm('You already have a snippet named "' + fresh.name + '". Replace it?')) {
                return;
            }
            const entry = {
                name: fresh.name,
                description: fresh.description || '',
                code: fresh.code
            };
            if (existing >= 0) {
                snippets[existing] = entry;
            } else {
                snippets.push(entry);
            }
            saveLocalSnippets(snippets);

            // refresh the logic builder's own local list too
            if (typeof window.loadCodeSnippets === 'function') {
                const search = document.getElementById('codeLibrarySearch');
                window.loadCodeSnippets(search ? search.value : '');
            }
            toast('"' + fresh.name + '" copied into your library', 'success');
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

        // Code library in the top bar (right of "My forms")
        on('codeLibraryBtn', 'click', function (event) {
            event.preventDefault();
            openCodeLibrary();
        });

        // Delete the selected control from the top bar
        on('deleteControlBtn', 'click', function () {
            if (typeof window.pfdDeleteSelectedControl === 'function') {
                window.pfdDeleteSelectedControl();
            }
        });

        // Public code library: publish (admins) / prefill from my snippets
        on('publishSnippetBtn', 'click', publishSnippet);

        // Library tabs + the shared search box (filters both libraries)
        on('libraryTabMine', 'click', function () {
            setLibraryTab('mine');
        });
        on('libraryTabPublic', 'click', function () {
            setLibraryTab('public');
        });

        const librarySearchInput = document.getElementById('codeLibraryModalSearch');
        if (librarySearchInput) {
            librarySearchInput.addEventListener('input', function () {
                renderPublicSnippets();
                updateLibraryCounts();
            });
        }

        // Keep the tab counters in step with the local list rendered by the designer
        const localList = document.getElementById('codeLibraryModalList');
        if (localList && window.MutationObserver) {
            new MutationObserver(function () {
                updateLibraryCounts();
            }).observe(localList, { childList: true, subtree: true });
        }
        const publishSource = document.getElementById('publishSnippetSource');
        if (publishSource) {
            publishSource.addEventListener('change', function () {
                const index = parseInt(this.value, 10);
                const snippets = localSnippets();
                if (!isNaN(index) && snippets[index]) {
                    fillPublishForm(snippets[index]);
                    state.editingSnippetId = null;
                    const status = document.getElementById('publishSnippetStatus');
                    if (status) status.textContent = 'Ready to publish your local snippet.';
                }
            });
        }

        // Opening the library from the original toolbar icon also loads the
        // public snippets.
        const legacyLibraryTrigger = document.querySelector('.toolbar-item[title="Code Library"]');
        if (legacyLibraryTrigger) {
            legacyLibraryTrigger.addEventListener('click', function () {
                loadPublicSnippets();
            });
        }

        // Logic builder: its Code Library tab lists local + public snippets
        const logicLibraryTabBtn = document.getElementById('codeLibraryTabBtn');
        if (logicLibraryTabBtn) {
            logicLibraryTabBtn.addEventListener('click', function () {
                const search = document.getElementById('codeLibrarySearch');
                if (typeof window.loadCodeSnippets === 'function') {
                    window.loadCodeSnippets(search ? search.value : '');
                }
                loadLogicBuilderSnippets();
            });
        }

        const logicLibrarySearch = document.getElementById('codeLibrarySearch');
        if (logicLibrarySearch) {
            logicLibrarySearch.addEventListener('input', function () {
                // filter the local list (the inline onkeyup does this too, but
                // this keeps it working even if that handler is unavailable)
                if (typeof window.loadCodeSnippets === 'function') {
                    window.loadCodeSnippets(this.value);
                }
                renderLogicBuilderSnippets();
            });
        }

        // Called by the inline onkeyup handler on that search box
        window.pfdFilterPublicSnippets = function () {
            renderLogicBuilderSnippets();
        };

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

        // The project name is its own field, so it never follows the selection
        const nameInput = document.getElementById('projectNameInput');
        if (nameInput) {
            nameInput.addEventListener('input', function () {
                state.nameTouched = true;
            });
            nameInput.addEventListener('change', function () {
                const statusFile = document.getElementById('statusFile');
                if (statusFile) {
                    statusFile.textContent = (this.value.trim() || 'Untitled') + '.py';
                }
            });
            nameInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    nameInput.blur();
                    saveToServer();
                }
            });
        }

        // Hooks called by the designer script
        window.pfdOnSelectionChanged = function (controlId) {
            const deleteBtn = document.getElementById('deleteControlBtn');
            if (deleteBtn) {
                deleteBtn.disabled = !controlId;
            }
        };

        window.pfdOnFormNameChanged = function (formName) {
            if (state.projectId || state.nameTouched) {
                return;
            }
            const input = document.getElementById('projectNameInput');
            if (input && document.activeElement !== input) {
                input.value = formName;
            }
            updateChip(formName);
        };

        updateChip(state.projectName);

        // New (unsaved) form: default the project name to the form's own name
        if (!state.projectId && !cfg.readOnly && nameInput && !nameInput.value) {
            const formProps = typeof window.pfdGetFormProperties === 'function'
                ? window.pfdGetFormProperties()
                : null;
            if (formProps && formProps.name) {
                nameInput.value = formProps.name;
            }
        }

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




