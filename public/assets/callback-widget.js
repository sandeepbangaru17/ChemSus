(function () {
  'use strict';

  const FAB_SIZE = 60;
  const FAB_RIGHT = 25;
  const FAB_GAP = 10;
  const BASE_BOTTOM = 25;

  // Inject CSS
  const css = `
#cb-widget{position:fixed;right:${FAB_RIGHT}px;z-index:99996;font-family:Arial,sans-serif;transition:bottom 0.2s ease;}
#cb-btn{background:linear-gradient(135deg,#ff6b35,#ff4500);color:#fff;border:none;border-radius:50%;width:${FAB_SIZE}px;height:${FAB_SIZE}px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.25);transition:transform 0.3s ease;position:relative;}
#cb-btn:hover{transform:scale(1.1);}
#cb-btn svg{width:28px;height:28px;fill:white;flex-shrink:0;}
#cb-tooltip{position:absolute;bottom:${FAB_SIZE + 8}px;right:50%;transform:translateX(50%);background:#1f2933;color:#fff;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap;opacity:0;visibility:hidden;transition:all 0.2s ease;pointer-events:none;}
#cb-btn:hover #cb-tooltip{opacity:1;visibility:visible;bottom:${FAB_SIZE + 4}px;}
#cb-popup{display:none;position:absolute;bottom:${FAB_SIZE + 16}px;right:0;width:310px;max-width:88vw;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.22);overflow:hidden;animation:cbSlideUp 0.3s ease-out;}
@keyframes cbSlideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
#cb-popup-header{background:linear-gradient(135deg,#ff6b35,#e8450a);color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;}
#cb-popup-header span:first-child{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;}
#cb-popup-close{cursor:pointer;font-size:20px;opacity:0.85;background:none;border:none;color:#fff;line-height:1;padding:0;}
#cb-popup-body{padding:18px 16px 20px;}
#cb-popup-body p{font-size:13.5px;color:#444;margin-bottom:14px;line-height:1.55;}
#cb-input-wrap{display:flex;gap:8px;align-items:center;}
#cb-phone{flex:1;padding:10px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;transition:border-color 0.2s;}
#cb-phone:focus{border-color:#ff6b35;box-shadow:0 0 0 3px rgba(255,107,53,0.12);}
#cb-submit{background:linear-gradient(135deg,#ff6b35,#e8450a);color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 3px 10px rgba(232,69,10,0.3);}
#cb-submit:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(232,69,10,0.4);}
#cb-submit:disabled{opacity:0.55;cursor:not-allowed;transform:none;box-shadow:none;}
#cb-msg{margin-top:12px;font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:7px;display:none;}
#cb-msg.ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0;display:block;}
#cb-msg.err{background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;display:block;}
@media(max-width:580px){#cb-widget{right:20px;}#cb-popup{width:min(310px,90vw);}#cb-btn{width:50px;height:50px;}#cb-btn svg{width:24px;height:24px;}}
`;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Inject HTML
  const html = `
<div id="cb-widget">
  <div id="cb-popup">
    <div id="cb-popup-header">
      <span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
        Request a Call Back
      </span>
      <button id="cb-popup-close" onclick="cbClose()" aria-label="Close">&times;</button>
    </div>
    <div id="cb-popup-body">
      <p>Leave your number and we'll call you back shortly.</p>
      <div id="cb-input-wrap">
        <input id="cb-phone" type="tel" placeholder="Your phone number" maxlength="15" autocomplete="tel" />
        <button id="cb-submit" onclick="cbSubmit()">Call Me</button>
      </div>
      <div id="cb-msg"></div>
    </div>
  </div>
  <button id="cb-btn" onclick="cbToggle()" aria-label="Request a call back">
    <svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
    <span id="cb-tooltip">Call Back</span>
  </button>
</div>`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  document.body.appendChild(wrapper.firstElementChild);

  function positionWidget() {
    const el = document.getElementById('cb-widget');
    if (!el) return;
    const hasWA = !!document.getElementById('ib-wa');
    const hasBrochure = !!document.querySelector('.download-section');
    const hasFloatingCart = !!document.querySelector('.floating-cart-btn');
    let levels = 0;
    if (hasWA) levels++;
    if (hasBrochure) levels++;
    if (hasFloatingCart) levels++;
    const isMobile = window.innerWidth <= 580;
    const fabSize = isMobile ? 50 : FAB_SIZE;
    const right = isMobile ? 20 : FAB_RIGHT;
    el.style.right = right + 'px';
    el.style.bottom = (BASE_BOTTOM + levels * (fabSize + FAB_GAP)) + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', positionWidget);
  } else {
    positionWidget();
  }
  window.addEventListener('resize', positionWidget);

  window.cbToggle = function () {
    const popup = document.getElementById('cb-popup');
    const isOpen = popup.style.display === 'block';
    popup.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById('cb-phone').focus();
  };

  window.cbClose = function () {
    document.getElementById('cb-popup').style.display = 'none';
  };

  window.cbSubmit = async function () {
    const input = document.getElementById('cb-phone');
    const phone = input.value.trim().replace(/[\s\-().+]/g, '');
    const msg = document.getElementById('cb-msg');
    const btn = document.getElementById('cb-submit');

    msg.className = '';
    msg.style.display = 'none';
    msg.textContent = '';

    if (!phone || !/^[0-9]{10,15}$/.test(phone)) {
      msg.textContent = 'Please enter a valid phone number (10–15 digits).';
      msg.className = 'err';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Opening…';

    // Save to DB (best-effort, don't block WhatsApp open)
    fetch('/api/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, page: window.location.pathname })
    }).catch(() => {});

    // Open WhatsApp with pre-filled message
    const waText = encodeURIComponent('Hi, I would like to request a callback. My number is ' + phone);
    window.open('https://wa.me/918486877575?text=' + waText, '_blank');

    msg.textContent = "WhatsApp opened! Just tap Send to request your callback.";
    msg.className = 'ok';
    input.value = '';
    setTimeout(cbClose, 4000);

    btn.disabled = false;
    btn.textContent = 'Call Me';
  };

  // Allow Enter key to submit
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.getElementById('cb-phone') === document.activeElement) {
      cbSubmit();
    }
  });
})();
