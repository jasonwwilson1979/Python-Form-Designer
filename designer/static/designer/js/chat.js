/* ==========================================================================
   Reusable polling chat widget used by the dashboard (lobby) and the
   designer page (per-form rooms).  No dependencies.
   ========================================================================== */
(function () {
    'use strict';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function formatTime(iso) {
        try {
            const date = new Date(iso);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (err) {
            return '';
        }
    }

    function csrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    async function request(url, options) {
        const opts = Object.assign({ headers: {} }, options || {});
        opts.headers = Object.assign(
            { 'X-CSRFToken': csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
            opts.headers
        );
        if (opts.body) opts.headers['Content-Type'] = 'application/json';
        const response = await fetch(url, opts);
        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            payload = null;
        }
        if (!response.ok || !payload || payload.ok === false) {
            const message = (payload && payload.error) || 'Request failed (' + response.status + ')';
            throw new Error(message);
        }
        return payload;
    }

    function create(options) {
        const cfg = Object.assign(
            {
                url: '',
                container: null,
                canPost: true,
                pollMs: 4000,
                loginUrl: '/accounts/login/',
                emptyText: 'No messages yet - say hello!',
                onMessages: null,
                placeholder: 'Write a message...'
            },
            options || {}
        );

        if (!cfg.container) {
            throw new Error('FormDesignerChat: container is required');
        }

        const root = cfg.container;
        root.innerHTML = '';
        root.classList.add('chat-body');

        const log = document.createElement('div');
        log.className = 'chat-log';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = cfg.emptyText;
        log.appendChild(empty);
        root.appendChild(log);

        let form = null;
        let input = null;
        if (cfg.canPost) {
            form = document.createElement('form');
            form.className = 'chat-form';
            form.innerHTML =
                '<input type="text" maxlength="2000" autocomplete="off" placeholder="' +
                escapeHtml(cfg.placeholder) +
                '" aria-label="Chat message">' +
                '<button type="submit" class="btn btn-primary btn-sm"><i class="fas fa-paper-plane"></i> Send</button>';
            root.appendChild(form);
            input = form.querySelector('input');
        } else {
            const note = document.createElement('div');
            note.className = 'chat-note';
            note.innerHTML =
                'You are viewing this chat read-only. <a href="' +
                escapeHtml(cfg.loginUrl) +
                '">Log in</a> to join the conversation.';
            root.appendChild(note);
        }

        let lastId = 0;
        let timer = null;
        let stopped = false;
        const seen = new Set();

        function appendMessage(message) {
            if (seen.has(message.id)) return;
            seen.add(message.id);
            if (message.id > lastId) lastId = message.id;

            if (empty.parentNode) empty.remove();

            const node = document.createElement('div');
            node.className = 'chat-msg' + (message.is_mine ? ' mine' : '');
            node.innerHTML =
                '<span class="who">' +
                escapeHtml(message.author || 'anonymous') +
                '<span class="when">' +
                escapeHtml(formatTime(message.created_at)) +
                '</span></span>' +
                escapeHtml(message.body);
            log.appendChild(node);
        }

        function scrollToBottom() {
            log.scrollTop = log.scrollHeight;
        }

        async function load(initial) {
            if (stopped) return;
            try {
                const url = cfg.url + (lastId && !initial ? '?after=' + lastId : '');
                const payload = await request(url, { method: 'GET' });
                const messages = payload.messages || [];
                messages.forEach(appendMessage);
                if (messages.length) {
                    scrollToBottom();
                    if (!initial && typeof cfg.onMessages === 'function') {
                        cfg.onMessages(messages);
                    }
                } else if (initial && !empty.parentNode) {
                    log.appendChild(empty);
                }
            } catch (err) {
                console.warn('Chat poll failed:', err.message);
            }
        }

        if (form) {
            form.addEventListener('submit', async function (event) {
                event.preventDefault();
                const body = (input.value || '').trim();
                if (!body) return;
                input.value = '';
                try {
                    const payload = await request(cfg.url, {
                        method: 'POST',
                        body: JSON.stringify({ body: body })
                    });
                    if (payload.message) {
                        appendMessage(payload.message);
                        scrollToBottom();
                    }
                } catch (err) {
                    input.value = body;
                    if (typeof cfg.onError === 'function') cfg.onError(err.message);
                }
            });
        }

        function startPolling() {
            if (stopped) return;
            clearTimeout(timer);
            timer = setTimeout(async function () {
                await load(false);
                startPolling();
            }, cfg.pollMs);
        }

        load(true).then(startPolling);

        return {
            reload: function () {
                lastId = 0;
                seen.clear();
                log.innerHTML = '';
                log.appendChild(empty);
                load(true);
            },
            stop: function () {
                stopped = true;
                clearTimeout(timer);
            },
            element: root
        };
    }

    window.FormDesignerChat = { create: create, escapeHtml: escapeHtml };
})();
