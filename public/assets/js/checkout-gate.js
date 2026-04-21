/**
 * checkout-gate.js
 * Shows a "Guest / Login" modal before proceeding to orders.html.
 * If the user already has a valid customer token, skips the modal entirely.
 *
 * Usage:
 *   checkoutGate(proceedFn)
 *   proceedFn — called when the user either is already logged in OR clicks "Continue as Guest"
 */

(function () {
  const MODAL_ID = 'checkoutGateModal';

  function isLoggedIn() {
    const tok = sessionStorage.getItem('chemsus_customer_token');
    const exp = Number(sessionStorage.getItem('chemsus_customer_token_exp') || 0);
    return !!tok && (!exp || Date.now() / 1000 < exp);
  }

  function injectStyles() {
    if (document.getElementById('checkoutGateStyles')) return;
    const style = document.createElement('style');
    style.id = 'checkoutGateStyles';
    style.textContent = `
      #checkoutGateModal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(15,23,42,.55);
        backdrop-filter: blur(3px);
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      #checkoutGateModal.open {
        display: flex;
      }
      .cg-card {
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(15,23,42,.18);
        padding: 36px 32px 28px;
        width: 100%;
        max-width: 400px;
        text-align: center;
        animation: cgSlideUp .22s ease;
      }
      @keyframes cgSlideUp {
        from { transform: translateY(20px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
      .cg-icon { font-size: 40px; margin-bottom: 14px; }
      .cg-title {
        font-family: "Montserrat", sans-serif;
        font-size: 20px; font-weight: 700; color: #0f172a;
        margin-bottom: 6px;
      }
      .cg-sub {
        font-size: 13px; color: #64748b;
        margin-bottom: 26px; line-height: 1.5;
      }
      .cg-btn {
        display: block; width: 100%;
        padding: 13px; border-radius: 10px;
        font-size: 14px; font-weight: 700;
        font-family: "Montserrat", sans-serif;
        cursor: pointer; border: none;
        transition: all .2s; margin-bottom: 10px;
        text-decoration: none;
      }
      .cg-btn-primary {
        background: linear-gradient(135deg, #0074c7, #00508a);
        color: #fff;
      }
      .cg-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,116,199,.3); }
      .cg-btn-ghost {
        background: transparent;
        border: 1.5px solid #e2e8f0 !important;
        color: #64748b;
      }
      .cg-btn-ghost:hover { border-color: #0074c7 !important; color: #0074c7; }
      .cg-divider {
        font-size: 12px; color: #94a3b8;
        margin: 4px 0 10px;
        position: relative;
      }
      .cg-divider::before, .cg-divider::after {
        content: ''; position: absolute; top: 50%;
        width: 42%; height: 1px; background: #e2e8f0;
      }
      .cg-divider::before { left: 0; }
      .cg-divider::after  { right: 0; }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyles();
    const div = document.createElement('div');
    div.id = MODAL_ID;
    div.innerHTML = `
      <div class="cg-card">
        <div class="cg-icon">🛍️</div>
        <div class="cg-title">How would you like to continue?</div>
        <p class="cg-sub">Log in for faster checkout with saved details and order tracking, or continue as a guest.</p>
        <button class="cg-btn cg-btn-primary" id="cgLoginBtn">Log In / Sign Up</button>
        <div class="cg-divider">or</div>
        <button class="cg-btn cg-btn-ghost" id="cgGuestBtn">Continue as Guest →</button>
      </div>
    `;
    document.body.appendChild(div);

    // Close on backdrop click
    div.addEventListener('click', function (e) {
      if (e.target === div) closeModal();
    });
  }

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.classList.remove('open');
  }

  function openModal(proceedFn) {
    buildModal();
    const modal = document.getElementById(MODAL_ID);
    modal.classList.add('open');

    // Wire buttons fresh each time (replace to remove old listeners)
    const loginBtn = document.getElementById('cgLoginBtn');
    const guestBtn = document.getElementById('cgGuestBtn');

    const newLoginBtn = loginBtn.cloneNode(true);
    const newGuestBtn = guestBtn.cloneNode(true);
    loginBtn.replaceWith(newLoginBtn);
    guestBtn.replaceWith(newGuestBtn);

    newLoginBtn.addEventListener('click', function () {
      closeModal();
      window.location.href = 'login.html?return=orders.html';
    });
    newGuestBtn.addEventListener('click', function () {
      closeModal();
      proceedFn();
    });
  }

  /**
   * Main entry point.
   * @param {Function} proceedFn  Called when the user is logged in or chooses Guest.
   *                              Should navigate to orders.html after setting sessionStorage.
   */
  window.checkoutGate = function (proceedFn) {
    if (isLoggedIn()) {
      proceedFn();
    } else {
      openModal(proceedFn);
    }
  };
})();
