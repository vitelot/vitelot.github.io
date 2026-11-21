// Builds the link to share with the group. Nothing typed here leaves the browser.
import { encodeSetup, decodeSetup } from './setupcode.js';

const url = document.getElementById('link-url');
const key = document.getElementById('link-key');
const out = document.getElementById('link-out');
const error = document.getElementById('link-error');
const copy = document.getElementById('link-copy');
const done = document.getElementById('link-done');

function build() {
  done.textContent = '';
  const address = url.value.trim();
  const groupKey = key.value.trim();
  const addressOk = decodeSetup(encodeSetup({ url: address, key: 'x' })) !== null;
  const valid = addressOk && groupKey !== '';
  out.value = valid ? new URL('./', location.href).href + '#' + encodeSetup({ url: address, key: groupKey }) : '';
  copy.disabled = !valid;
  error.hidden = address === '' || addressOk;
}

url.addEventListener('input', build);
key.addEventListener('input', build);
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(out.value);
    done.textContent = 'Copied';
  } catch {
    out.select();
    done.textContent = 'Select the link and copy it';
  }
});
build();
