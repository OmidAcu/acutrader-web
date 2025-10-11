// Simple monthly/annual toggle + Paddle checkout opener

const toggle = document.getElementById('billing-toggle');
const labelEls = document.querySelectorAll('.js-billing-label');
const priceNT = document.querySelector('.js-nt-price');
const priceTV = document.querySelector('.js-tv-price');
const priceDual = document.querySelector('.js-dual-price');

function applyPricing() {
  const annual = toggle.checked;
  labelEls.forEach(el => (el.textContent = annual ? 'year' : 'month'));
  // Monthly: NT/TV 39.99, Dual 59.99
  // Annual: apply 30% discount: 39.99*12*0.7 ≈ 335 (display rounded), dual ≈ 504
  if (annual) {
    priceNT.textContent = '335';
    priceTV.textContent = '335';
    priceDual.textContent = '504';
  } else {
    priceNT.textContent = '39.99';
    priceTV.textContent = '39.99';
    priceDual.textContent = '59.99';
  }
}
applyPricing();
toggle?.addEventListener('change', applyPricing);

// Lazy-load Paddle (Billing/Checkout v2) when a button is clicked.
// NOTE: Replace the token & product IDs with your Paddle sandbox values.
let paddleLoaded = false;

async function loadPaddle() {
  if (paddleLoaded) return window.Paddle;
  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  document.head.appendChild(script);
  await new Promise(res => (script.onload = res));
  // IMPORTANT: set sandbox + initialize with your public token from Paddle dashboard
  window.Paddle.Environment.set('sandbox'); // remove in production
  // Replace with your Paddle "Client-side token" (public)
  window.Paddle.Initialize({ token: 'test_f2d749debb7c87af3996d052dfd' });
  paddleLoaded = true;
  return window.Paddle;
}

async function openCheckout(productId) {
  const Paddle = await loadPaddle();
  // Minimal checkout; you can add customer email, passthrough, etc.
  Paddle.Checkout.open({ product: productId });
}

// Wire buttons
document.querySelectorAll('button[data-plan]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const annual = toggle.checked;
    const productId = annual ? btn.dataset.annualProduct : btn.dataset.monthlyProduct;
    if (!productId || productId.startsWith('REPLACE')) {
      alert('Configure your Paddle product IDs in the button data attributes.');
      return;
    }
    openCheckout(productId);
  });
});
