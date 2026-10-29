/* ==========================================================================
   Shared Code Library dialog (used on the dashboard / profile pages).

   Two tabs:
     * "My snippets"   - snippets cached in this browser (localStorage)
     * "Public library" - snippets published to the database by administrators;
                          anyone can copy them into their own browser library.

   One search box filters both lists.  Markup is built here so any page can use
   it with a single call:  FormDesignerLibrary.mount({api: {...}, user: {...}})
   ========================================================================== */
(function () {
    'use strict';

    const LOCAL_KEY = 'codeSnippets';

    const state = {
        api: {},
        user: {},
        loginUrl: '/accounts/login/',
        snippets: [],
        canPublish: false,
        tab: 'mine',
        editingIndex: null,
        editingPublicId: null,
        mounted: false,
        els: {}
    };

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
            const error = new Error((payload && payload.error) || 'Request failed (' + response.status + ')');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function toast(message, kind) {
        let stack = document.querySelector('.toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'toast-stack';
            document.body.appendChild(stack);
        }
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
        }, 2800);
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

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    /* ------------------------------------------------------- local snippets */
    function localSnippets() {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
        } catch (err) {
            return [];
        }
    }

    function saveLocalSnippets(snippets) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(snippets));
        renderLocal();
        updateCounts();
    }

    /* ------------------------------------------------------------ searching */
    function searchTerm() {
        return state.els.search ? state.els.search.value.trim() : '';
    }

    function snippetMatches(snippet) {
        const term = searchTerm().toLowerCase();
        if (!term) return true;
        return [snippet.name, snippet.description, snippet.code]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(term);
    }

    /* ------------------------------------------------------------ the modal */
    function buildModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-backdrop';
        overlay.id = 'libraryModal';
        overlay.innerHTML =
            '<div class="modal-panel library-modal" role="dialog" aria-modal="true" aria-labelledby="libraryModalTitle">' +
                '<header>' +
                    '<h2 id="libraryModalTitle"><i class="fas fa-code"></i> Code Library</h2>' +
                    '<button type="button" class="close" data-close aria-label="Close">&times;</button>' +
                '</header>' +
                '<div class="library-bar">' +
                    '<div class="library-tabs" role="tablist">' +
                        '<button type="button" class="library-tab active" data-tab="mine" role="tab" aria-selected="true">' +
                            '<i class="fas fa-hdd"></i> My snippets <span class="library-count" data-count="mine">0</span>' +
                        '</button>' +
                        '<button type="button" class="library-tab" data-tab="public" role="tab" aria-selected="false">' +
                            '<i class="fas fa-globe"></i> Public library <span class="library-count" data-count="public">0</span>' +
                        '</button>' +
                    '</div>' +
                    '<div class="library-search">' +
                        '<i class="fas fa-search"></i>' +
                        '<input type="text" data-search placeholder="Search both libraries by name or description...">' +
                    '</div>' +
                '</div>' +
                '<div class="body">' +
                    '<section class="library-pane active" data-pane="mine" role="tabpanel">' +
                        '<div class="library-editor">' +
                            '<div class="library-editor-row">' +
                                '<input type="text" class="property-input" data-editor="name" placeholder="Snippet name">' +
                                '<input type="text" class="property-input" data-editor="description" placeholder="Description (optional)">' +
                            '</div>' +
                            '<textarea class="property-input" rows="4" data-editor="code" placeholder="Enter your Python code snippet here..."></textarea>' +
                            '<div class="library-editor-actions">' +
                                '<button type="button" class="btn btn-primary btn-sm" data-action="save-snippet">' +
                                    '<i class="fas fa-plus"></i> <span data-save-label>Add snippet</span>' +
                                '</button>' +
                                '<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-edit" hidden>Cancel edit</button>' +
                                '<span class="library-hint">Saved in this browser (localStorage)</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="library-list" data-list="mine"></div>' +
                    '</section>' +
                    '<section class="library-pane" data-pane="public" role="tabpanel">' +
                        '<div class="library-public-head">' +
                            '<span class="library-hint" data-hint>Shared snippets published by administrators</span>' +
                        '</div>' +
                        '<div class="publish-panel" data-publish-panel hidden>' +
                            '<select class="property-input" data-publish="source" title="Fill the form from one of your own snippets">' +
                                '<option value="">&mdash; choose one of my snippets &mdash;</option>' +
                            '</select>' +
                            '<div class="publish-grid">' +
                                '<input type="text" class="property-input" data-publish="name" placeholder="Snippet name">' +
                                '<input type="text" class="property-input" data-publish="description" placeholder="Description (optional)">' +
                            '</div>' +
                            '<textarea class="property-input" rows="4" data-publish="code" placeholder="Python code..."></textarea>' +
                            '<div class="publish-actions">' +
                                '<button type="button" class="btn btn-primary btn-sm" data-action="publish">' +
                                    '<i class="fas fa-cloud-upload-alt"></i> Publish to public library' +
                                '</button>' +
                                '<span class="publish-status" data-publish-status></span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="library-list" data-list="public"></div>' +
                    '</section>' +
                '</div>' +
                '<div class="footer">' +
                    '<span class="library-footer-hint" data-footer></span>' +
                    '<button type="button" class="btn btn-secondary" data-close>Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function cacheElements() {
        const overlay = state.els.overlay;
        state.els.tabs = overlay.querySelectorAll('.library-tab');
        state.els.panes = overlay.querySelectorAll('.library-pane');
        state.els.search = overlay.querySelector('[data-search]');
        state.els.countMine = overlay.querySelector('[data-count="mine"]');
        state.els.countPublic = overlay.querySelector('[data-count="public"]');
        state.els.listMine = overlay.querySelector('[data-list="mine"]');
        state.els.listPublic = overlay.querySelector('[data-list="public"]');
        state.els.hint = overlay.querySelector('[data-hint]');
        state.els.footer = overlay.querySelector('[data-footer]');
        state.els.editor = {
            name: overlay.querySelector('[data-editor="name"]'),
            description: overlay.querySelector('[data-editor="description"]'),
            code: overlay.querySelector('[data-editor="code"]'),
            saveLabel: overlay.querySelector('[data-save-label]'),
            cancel: overlay.querySelector('[data-action="cancel-edit"]')
        };
        state.els.publishPanel = overlay.querySelector('[data-publish-panel]');
        state.els.publish = {
            source: overlay.querySelector('[data-publish="source"]'),
            name: overlay.querySelector('[data-publish="name"]'),
            description: overlay.querySelector('[data-publish="description"]'),
            code: overlay.querySelector('[data-publish="code"]'),
            status: overlay.querySelector('[data-publish-status]')
        };
    }

    function setTab(name) {
        state.tab = name;
        state.els.tabs.forEach(function (tab) {
            const active = tab.dataset.tab === name;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        state.els.panes.forEach(function (pane) {
            pane.classList.toggle('active', pane.dataset.pane === name);
        });
        updateCounts();
    }

    function updateCounts() {
        const term = searchTerm();
        const local = localSnippets();
        const localMatches = local.filter(snippetMatches).length;
        const published = state.snippets || [];
        const publicMatches = published.filter(snippetMatches).length;

        if (state.els.countMine) state.els.countMine.textContent = String(localMatches);
        if (state.els.countPublic) state.els.countPublic.textContent = String(publicMatches);
        if (state.els.footer) {
            state.els.footer.textContent = local.length + ' in this browser - ' +
                published.length + ' published' +
                (term ? ' - filtered by "' + term + '"' : '');
        }
    }

    /* ------------------------------------------------------------ card view */
    function buildCard(options) {
        const card = document.createElement('div');
        card.className = 'public-snippet';

        const head = document.createElement('div');
        head.className = 'public-snippet-head';
        const title = document.createElement('strong');
        title.textContent = options.name;
        head.appendChild(title);
        if (options.meta) {
            const meta = document.createElement('span');
            meta.className = 'public-snippet-meta';
            meta.textContent = options.meta;
            head.appendChild(meta);
        }
        card.appendChild(head);

        if (options.description) {
            const description = document.createElement('div');
            description.className = 'public-snippet-description';
            description.textContent = options.description;
            card.appendChild(description);
        }

        if (options.code) {
            const wrap = document.createElement('details');
            wrap.className = 'public-snippet-code-wrap';
            const summary = document.createElement('summary');
            summary.textContent = 'Show code';
            const pre = document.createElement('pre');
            pre.className = 'public-snippet-code';
            pre.textContent = options.code;
            wrap.appendChild(summary);
            wrap.appendChild(pre);
            card.appendChild(wrap);
        }

        const actions = document.createElement('div');
        actions.className = 'public-snippet-actions';
        (options.actions || []).forEach(function (action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-sm ' + (action.className || 'btn-ghost');
            button.innerHTML = '<i class="fas ' + action.icon + '"></i> ' + escapeHtml(action.label);
            if (action.title) button.title = action.title;
            button.addEventListener('click', action.onClick);
            actions.appendChild(button);
        });
        card.appendChild(actions);
        return card;
    }

    function emptyState(container, message) {
        container.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = message;
        container.appendChild(empty);
    }

    /* -------------------------------------------------------- my snippets */
    function renderLocal() {
        const list = state.els.listMine;
        if (!list) return;
        const term = searchTerm();
        const entries = localSnippets()
            .map(function (snippet, index) {
                return { snippet: snippet, index: index };
            })
            .filter(function (entry) {
                return snippetMatches(entry.snippet);
            });

        list.innerHTML = '';
        if (!entries.length) {
            emptyState(list, term
                ? 'No snippets in this browser match "' + term + '".'
                : 'No code snippets saved in this browser yet - add one above.');
            return;
        }

        entries.forEach(function (entry) {
            list.appendChild(buildCard({
                name: entry.snippet.name,
                description: entry.snippet.description,
                code: entry.snippet.code,
                meta: 'in this browser',
                actions: [
                    {
                        label: 'Copy code', icon: 'fa-clipboard', className: 'btn-primary',
                        onClick: async function () {
                            const ok = await copyText(entry.snippet.code);
                            toast(ok ? 'Snippet code copied' : 'Could not copy the snippet', ok ? 'success' : 'error');
                        }
                    },
                    {
                        label: 'Edit', icon: 'fa-pen',
                        onClick: function () {
                            startEditingLocal(entry.index);
                        }
                    },
                    {
                        label: 'Delete', icon: 'fa-trash-alt', className: 'btn-danger',
                        title: 'Delete this snippet', onClick: function () {
                            deleteLocal(entry.index);
                        }
                    }
                ]
            }));
        });
    }

    function startEditingLocal(index) {
        const snippet = localSnippets()[index];
        if (!snippet) return;
        state.editingIndex = index;
        state.els.editor.name.value = snippet.name || '';
        state.els.editor.description.value = snippet.description || '';
        state.els.editor.code.value = snippet.code || '';
        state.els.editor.saveLabel.textContent = 'Save changes';
        state.els.editor.cancel.hidden = false;
        setTab('mine');
        state.els.editor.name.focus();
    }

    function resetEditor() {
        state.editingIndex = null;
        state.els.editor.name.value = '';
        state.els.editor.description.value = '';
        state.els.editor.code.value = '';
        state.els.editor.saveLabel.textContent = 'Add snippet';
        state.els.editor.cancel.hidden = true;
    }

    function saveLocalFromEditor() {
        const name = state.els.editor.name.value.trim();
        const description = state.els.editor.description.value.trim();
        const code = state.els.editor.code.value;
        if (!name || !code.trim()) {
            toast('A snippet needs both a name and some code.', 'error');
            return;
        }

        const snippets = localSnippets();
        const duplicate = snippets.findIndex(function (snippet, index) {
            return index !== state.editingIndex && snippet.name.toLowerCase() === name.toLowerCase();
        });
        if (duplicate >= 0) {
            toast('You already have a snippet with that name.', 'error');
            return;
        }

        if (state.editingIndex !== null && snippets[state.editingIndex]) {
            snippets[state.editingIndex] = { name: name, description: description, code: code };
            toast('Snippet updated', 'success');
        } else {
            snippets.push({ name: name, description: description, code: code });
            toast('Snippet saved in this browser', 'success');
        }

        resetEditor();
        saveLocalSnippets(snippets);
    }

    function deleteLocal(index) {
        const snippets = localSnippets();
        const snippet = snippets[index];
        if (!snippet) return;
        if (!window.confirm('Delete "' + snippet.name + '" from this browser?')) return;
        snippets.splice(index, 1);
        if (state.editingIndex === index) resetEditor();
        saveLocalSnippets(snippets);
        toast('Snippet deleted', 'success');
    }

    /* ------------------------------------------------------ public library */
    async function loadPublic() {
        if (!state.els.listPublic) return;
        try {
            const payload = await apiRequest(state.api.snippets, { method: 'GET' });
            state.snippets = payload.snippets || [];
            state.canPublish = !!payload.can_publish;
        } catch (err) {
            state.snippets = [];
            emptyState(state.els.listPublic, err.message);
            updateCounts();
            return;
        }

        if (state.els.publishPanel) state.els.publishPanel.hidden = !state.canPublish;
        if (state.els.hint) {
            state.els.hint.textContent = state.canPublish
                ? 'You can publish, edit and remove shared snippets (administrator)'
                : 'Shared snippets published by administrators - copy any of them into your own library';
        }
        populatePublishSource();
        renderPublic();
        updateCounts();
    }

    function renderPublic() {
        const list = state.els.listPublic;
        if (!list) return;
        const term = searchTerm();
        const snippets = (state.snippets || []).filter(snippetMatches);
        list.innerHTML = '';

        if (!snippets.length) {
            emptyState(list, term
                ? 'No public snippets match "' + term + '".'
                : 'No public snippets have been published yet.');
            return;
        }

        snippets.forEach(function (snippet) {
            const actions = [
                {
                    label: 'Copy to my library', icon: 'fa-copy', className: 'btn-primary',
                    onClick: function () {
                        copyPublicSnippet(snippet);
                    }
                },
                {
                    label: 'Copy code', icon: 'fa-clipboard',
                    onClick: async function () {
                        const ok = await copyText(snippet.code);
                        toast(ok ? 'Snippet code copied' : 'Could not copy the snippet', ok ? 'success' : 'error');
                    }
                }
            ];
            if (snippet.can_edit) {
                actions.push({
                    label: 'Edit', icon: 'fa-pen',
                    onClick: function () {
                        fillPublishForm(snippet);
                    }
                });
                actions.push({
                    label: 'Delete', icon: 'fa-trash-alt', className: 'btn-danger',
                    title: 'Remove from the public library', onClick: function () {
                        deletePublic(snippet);
                    }
                });
            }

            list.appendChild(buildCard({
                name: snippet.name,
                description: snippet.description,
                code: snippet.code,
                meta: 'by ' + snippet.created_by +
                    (snippet.is_public ? '' : ' - draft') +
                    ' - ' + snippet.copy_count + ' copy' + (snippet.copy_count === 1 ? '' : 'ies'),
                actions: actions
            }));
        });
    }

    async function copyPublicSnippet(snippet) {
        try {
            const payload = await apiRequest(
                state.api.snippetCopyTemplate.replace('__ID__', snippet.id),
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
            loadPublic();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async function deletePublic(snippet) {
        if (!window.confirm('Remove "' + snippet.name + '" from the public library?')) return;
        try {
            await apiRequest(state.api.snippetTemplate.replace('__ID__', snippet.id), { method: 'DELETE' });
            toast('Snippet removed from the public library', 'success');
            loadPublic();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    function populatePublishSource() {
        const select = state.els.publish && state.els.publish.source;
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
        const publish = state.els.publish;
        if (!publish) return;
        publish.name.value = snippet.name || '';
        publish.description.value = snippet.description || '';
        publish.code.value = snippet.code || '';
        state.editingPublicId = snippet.id || null;
        publish.status.textContent = snippet.id ? 'Editing public snippet #' + snippet.id : '';
        if (state.els.publishPanel) state.els.publishPanel.hidden = false;
        setTab('public');
        publish.name.focus();
    }

    async function publishSnippet() {
        const publish = state.els.publish;
        if (!publish) return;
        const payload = {
            name: publish.name.value.trim(),
            description: publish.description.value.trim(),
            code: publish.code.value,
            is_public: true
        };
        if (!payload.name || !payload.code.trim()) {
            publish.status.textContent = 'Name and code are both required.';
            return;
        }

        try {
            if (state.editingPublicId) {
                await apiRequest(state.api.snippetTemplate.replace('__ID__', state.editingPublicId), {
                    method: 'PATCH',
                    body: payload
                });
            } else {
                await apiRequest(state.api.snippets, { method: 'POST', body: payload });
            }
            publish.status.textContent = 'Published.';
            state.editingPublicId = null;
            publish.name.value = '';
            publish.description.value = '';
            publish.code.value = '';
            toast('Snippet published to the public library', 'success');
            loadPublic();
        } catch (err) {
            publish.status.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    /* --------------------------------------------------------- open/close */
    let tabChosen = false;

    function open() {
        if (!state.els.overlay) return;
        state.els.overlay.classList.add('open');
        renderLocal();
        setTab(tabChosen ? state.tab : 'mine');
        loadPublic().then(function () {
            if (tabChosen) return;
            tabChosen = true;
            if (!localSnippets().length && (state.snippets || []).length) {
                setTab('public');
            }
        });
    }

    function close() {
        if (state.els.overlay) state.els.overlay.classList.remove('open');
    }

    /* --------------------------------------------------------------- mount */
    function mount(config) {
        if (state.mounted) return;
        const cfg = config || {};
        state.api = cfg.api || {};
        state.user = cfg.user || {};
        state.loginUrl = cfg.loginUrl || '/accounts/login/';
        if (!state.api.snippets || !state.api.snippetTemplate || !state.api.snippetCopyTemplate) {
            return;
        }

        state.els.overlay = buildModal();
        cacheElements();
        const overlay = state.els.overlay;

        state.els.tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                setTab(tab.dataset.tab);
            });
        });

        overlay.querySelectorAll('[data-close]').forEach(function (button) {
            button.addEventListener('click', close);
        });

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) close();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && overlay.classList.contains('open')) close();
        });

        state.els.search.addEventListener('input', function () {
            renderLocal();
            renderPublic();
            updateCounts();
        });

        state.els.editor.cancel.addEventListener('click', resetEditor);
        overlay.querySelector('[data-action="save-snippet"]').addEventListener('click', saveLocalFromEditor);
        overlay.querySelector('[data-action="publish"]').addEventListener('click', publishSnippet);

        state.els.publish.source.addEventListener('change', function () {
            const index = parseInt(this.value, 10);
            const snippets = localSnippets();
            if (!isNaN(index) && snippets[index]) {
                fillPublishForm(snippets[index]);
                state.editingPublicId = null;
                state.els.publish.status.textContent = 'Ready to publish your local snippet.';
            }
        });

        const trigger = document.getElementById('codeLibraryNavBtn');
        if (trigger) {
            trigger.addEventListener('click', function (event) {
                event.preventDefault();
                open();
            });
        }

        state.mounted = true;
        renderLocal();
        updateCounts();
    }

    window.FormDesignerLibrary = {
        mount: mount,
        open: open,
        close: close,
        toast: toast
    };
})();