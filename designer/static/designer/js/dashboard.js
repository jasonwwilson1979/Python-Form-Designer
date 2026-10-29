/* ==========================================================================
   Dashboard: form cards (open / duplicate / delete / share link / download)
   plus the community lobby chat.
   ========================================================================== */
(function () {
    'use strict';

    const bootstrapEl = document.getElementById('dashboard-bootstrap');
    if (!bootstrapEl) return;
    const cfg = JSON.parse(bootstrapEl.textContent);

    const csrf = () => {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

    async function api(url, options) {
        const opts = Object.assign({ headers: {} }, options || {});
        opts.headers = Object.assign({ 'X-CSRFToken': csrf() }, opts.headers);
        if (opts.body) opts.headers['Content-Type'] = 'application/json';
        const response = await fetch(url, opts);
        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            payload = null;
        }
        if (!response.ok || !payload || payload.ok === false) {
            throw new Error((payload && payload.error) || 'Request failed (' + response.status + ')');
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
        requestAnimationFrame(() => node.classList.add('show'));
        setTimeout(() => {
            node.classList.remove('show');
            setTimeout(() => node.remove(), 250);
        }, 2600);
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

    const grid = document.getElementById('project-list');
    if (grid) {
        grid.addEventListener('click', async function (event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            const id = button.dataset.id;
            const name = button.dataset.name || 'this form';
            const card = button.closest('.project-card');

            try {
                if (action === 'open') {
                    window.location.href = cfg.urls.project.replace('__ID__', id);
                } else if (action === 'download') {
                    window.location.href = cfg.urls.download.replace('__ID__', id);
                } else if (action === 'copy-link') {
                    const ok = await copyText(button.dataset.shareUrl || '');
                    toast(ok ? 'Share link copied to clipboard' : 'Could not copy the link', ok ? 'success' : 'error');
                } else if (action === 'duplicate') {
                    const payload = await api(cfg.api.duplicate.replace('__ID__', id), { method: 'POST' });
                    toast('Duplicated as "' + payload.project.name + '"', 'success');
                    window.location.href = payload.project.url;
                } else if (action === 'delete') {
                    if (!window.confirm('Delete "' + name + '"? This cannot be undone.')) return;
                    await api(cfg.api.project.replace('__ID__', id), { method: 'DELETE' });
                    toast('Deleted "' + name + '"', 'success');
                    if (card) card.remove();
                }
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    }

    const chatContainer = document.getElementById('lobby-chat');
    if (chatContainer && window.FormDesignerChat) {
        window.FormDesignerChat.create({
            url: cfg.api.lobbyChat,
            container: chatContainer,
            canPost: cfg.user.isAuthenticated,
            loginUrl: cfg.urls.login,
            emptyText: 'The lobby is quiet - start the conversation!',
            onError: (message) => toast(message, 'error')
        });
    }
})();
