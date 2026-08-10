'use strict';

// Demo configuration — see README. APP_SECRET must equal the APP_SECRET value
// in backend/.env. BACKEND_URL stays '' when this page is served by the
// backend itself (same origin); set it to 'http://<host>:8787' otherwise.
const APP_CONFIG = {
  BACKEND_URL: '',
  APP_SECRET: 'change-me-app-secret',
  TENANT_ID: 'demo',
};

const form = document.getElementById('command-form');
const input = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const responseEl = document.getElementById('response');

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(state, html) {
  responseEl.className = `response ${state}`;
  responseEl.innerHTML = html;
}

async function sendCommand(text) {
  const clean = (text || '').trim();
  if (!clean) {
    input.focus();
    return;
  }

  sendBtn.disabled = true;
  render('sending', '<p class="dots">جاري الإرسال<span>.</span><span>.</span><span>.</span></p>');

  try {
    const res = await fetch(`${APP_CONFIG.BACKEND_URL}/api/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-secret': APP_CONFIG.APP_SECRET,
      },
      body: JSON.stringify({ tenantId: APP_CONFIG.TENANT_ID, text: clean }),
    });

    if (res.status === 401) {
      render('error', '<p>السر غير صحيح — تأكد أن APP_SECRET في app.js يطابق backend/.env</p>');
      return;
    }
    if (res.status === 429) {
      render('error', '<p>طلبات كثيرة خلال دقيقة — انتظر شوي وحاول مرة ثانية</p>');
      return;
    }
    if (!res.ok) {
      render('error', `<p>خطأ من الخادم (${res.status})</p>`);
      return;
    }

    const data = await res.json();
    if (data.queued) {
      render(
        'ok',
        `<p class="msg">${esc(data.message)}</p>` +
          `<code class="chip">${esc(data.action)} ${esc(JSON.stringify(data.params || {}))}</code>`
      );
      input.value = '';
    } else {
      render(
        'none',
        `<p class="msg">${esc(data.message || 'لم أفهم الطلب')}</p>` +
          '<p class="hint">جرّب طلب واضح مثل «ابغى سيارة شرطة» أو «خلّ الجو مطر»</p>'
      );
    }
  } catch (_) {
    render('error', '<p>تعذّر الاتصال بالخادم — تأكد أن الباك إند شغّال</p>');
  } finally {
    sendBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendCommand(input.value);
});

// Shared surface for voice.js: fill the box, send, and show errors.
window.AppCommand = {
  send: sendCommand,
  input,
  notify: (message) => render('error', `<p>${esc(message)}</p>`),
};
