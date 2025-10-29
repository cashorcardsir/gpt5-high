// can-loader.js
(() => {
  'use strict';

  const DEFAULTS = {
    color: '#ff7a00',
    background: 'rgba(18, 18, 20, 0.92)',
    textColor: '#ffffff',
    showPercentage: true,
    includeBackgroundImages: true,
    zIndex: 999999,
    minDuration: 300,
    waveSpeedSec: 3.5
  };

  function lighten(hex, pct = 25) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = Math.min(255, Math.round(r + (255 - r) * (pct / 100)));
    g = Math.min(255, Math.round(g + (255 - g) * (pct / 100)));
    b = Math.min(255, Math.round(b + (255 - b) * (pct / 100)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  const WEIGHTS = { dom: 30, fonts: 20, imgs: 50 };

  const CanLoader = {
    opts: { ...DEFAULTS },
    overlayEl: null,
    percentEl: null,
    fillLevelEl: null,
    canClipRect: null,
    startTime: 0,
    domDone: false,
    fontsDone: false,
    imgTotal: 0,
    imgLoaded: 0,
    finished: false,

    init(options = {}) {
      this.opts = { ...DEFAULTS, ...options };
      this.startTime = performance.now();
      this.injectStyles();
      this.buildDOM();
      this.trackDOMReady();
      this.trackFonts();
      this.trackImages();
      window.addEventListener('load', () => this.finish());
    },

    injectStyles() {
      const style = document.createElement('style');
      style.setAttribute('data-can-loader', 'true');
      style.textContent = `
        .can-loader-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${this.opts.background};
          z-index: ${this.opts.zIndex};
          transition: opacity 400ms ease;
        }
        .can-loader-overlay.hide {
          opacity: 0;
          pointer-events: none;
        }
        .can-loader {
          text-align: center;
          color: ${this.opts.textColor};
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
          user-select: none;
        }
        .can-percent {
          margin-top: 12px;
          font-size: 16px;
          font-weight: 600;
        }
        .wave-shift {
          transform-box: fill-box;
          animation: can-wave ${this.opts.waveSpeedSec}s linear infinite;
        }
        @keyframes can-wave {
          from { transform: translateX(0); }
          to   { transform: translateX(-200px); }
        }
        .fill-level {
          transform-box: fill-box;
          transition: transform 420ms cubic-bezier(.22,.61,.36,1);
        }
        @media (prefers-reduced-motion: reduce) {
          .wave-shift { animation: none; }
          .fill-level { transition: none; }
        }
      `;
      document.head.appendChild(style);
    },

    buildDOM() {
      const overlay = document.createElement('div');
      overlay.className = 'can-loader-overlay';
      overlay.setAttribute('aria-hidden', 'true');

      overlay.innerHTML = `
        <div class="can-loader">
          <svg width="200" height="300" viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" aria-label="Loading can">
            <defs>
              <clipPath id="canClip">
                <rect id="canClipRect" x="50" y="50" width="100" height="200" rx="10" ry="10"></rect>
              </clipPath>
            </defs>
            
            <!-- Static can structure -->
            <rect x="50" y="50" width="100" height="200" rx="10" ry="10" fill="none" stroke="#999" stroke-width="2"/>
            <ellipse cx="100" cy="50" rx="50" ry="10" fill="#ccc" stroke="#999" stroke-width="2"/>
            <ellipse cx="100" cy="55" rx="48" ry="8" fill="#ddd"/>
            <ellipse cx="100" cy="250" rx="50" ry="10" fill="#ccc" stroke="#999" stroke-width="2"/>
            <ellipse cx="100" cy="245" rx="48" ry="8" fill="#ddd"/>
            <path d="M52,55 L52,245 Q52,248 55,250 L95,250 Q98,250 100,248 L100,52 Q100,50 98,52 L55,52 Q52,52 52,55 Z" 
                  fill="none" stroke="#fff" stroke-width="1" opacity="0.4"/>
            <ellipse cx="100" cy="58" rx="45" ry="7" fill="#bbb"/>
            <line x1="150" y1="55" x2="150" y2="245" stroke="#aaa" stroke-width="0.5" stroke-dasharray="2,2"/>
            <ellipse cx="100" cy="265" rx="60" ry="8" fill="rgba(0,0,0,0.1)"/>

            <!-- Liquid filling area -->
            <g clip-path="url(#canClip)">
              <g class="fill-level" style="transform: translateY(250px);">
                <g class="wave-shift">
                  <path d="M -200 60 
                           Q -175 40 -150 60 T -100 60 T -50 60 T 0 60 T 50 60 T 100 60 T 150 60 T 200 60 T 250 60 T 300 60 T 350 60 T 400 60
                           L 400 260 L -200 260 Z"
                        fill="${this.opts.color}" opacity="0.92"></path>
                  <path d="M -200 55 
                           Q -175 40 -150 55 T -100 55 T -50 55 T 0 55 T 50 55 T 100 55 T 150 55 T 200 55 T 250 55 T 300 55 T 350 55 T 400 55
                           L 400 260 L -200 260 Z"
                        fill="${lighten(this.opts.color, 30)}" opacity="0.65"></path>
                </g>
              </g>
            </g>
          </svg>
          <div class="can-percent">${this.opts.showPercentage ? '0%' : ''}</div>
        </div>
      `;

      document.body.appendChild(overlay);
      this.overlayEl = overlay;
      this.percentEl = overlay.querySelector('.can-percent');
      this.fillLevelEl = overlay.querySelector('.fill-level');
      this.canClipRect = overlay.querySelector('#canClipRect');
    },

    computeProgress() {
      const domPart = this.domDone ? WEIGHTS.dom : 0;
      const fontPart = this.fontsDone ? WEIGHTS.fonts : 0;
      const imgPart = this.imgTotal > 0 ? WEIGHTS.imgs * (this.imgLoaded / this.imgTotal) : 0;
      let progress = domPart + fontPart + imgPart;
      if (progress >= 99 && !this.finished) progress = 99;
      return Math.min(100, Math.max(0, Math.round(progress)));
    },

    applyProgress(pct) {
      if (this.percentEl && this.opts.showPercentage) {
        this.percentEl.textContent = `${pct}%`;
      }
      const rectY = parseFloat(this.canClipRect.getAttribute('y'));
      const rectH = parseFloat(this.canClipRect.getAttribute('height'));
      const crestLocalY = 60;
      const desiredY = rectY + rectH - (pct / 100) * rectH;
      const tY = desiredY - crestLocalY;
      if (this.fillLevelEl) {
        this.fillLevelEl.style.transform = `translateY(${tY}px)`;
      }
    },

    update() {
      const pct = this.computeProgress();
      this.applyProgress(pct);
    },

    finish() {
      if (this.finished) return;
      this.finished = true;
      this.applyProgress(100);
      const elapsed = performance.now() - this.startTime;
      const remaining = Math.max(0, this.opts.minDuration - elapsed);
      setTimeout(() => {
        this.overlayEl.classList.add('hide');
        setTimeout(() => {
          if (this.overlayEl && this.overlayEl.parentNode) {
            this.overlayEl.parentNode.removeChild(this.overlayEl);
          }
        }, 420);
      }, remaining);
    },

    trackDOMReady() {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        this.domDone = true;
        this.update();
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          this.domDone = true;
          this.update();
        }, { once: true });
      }
    },

    trackFonts() {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          this.fontsDone = true;
          this.update();
        }).catch(() => {
          this.fontsDone = true;
          this.update();
        });
      } else {
        this.fontsDone = true;
        this.update();
      }
    },

    trackImages() {
      const urls = new Set();
      document.querySelectorAll('img').forEach(img => {
        const src = img.currentSrc || img.src;
        if (src) urls.add(src);
      });
      if (this.opts.includeBackgroundImages) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const bg = getComputedStyle(el).getPropertyValue('background-image');
          if (bg && bg !== 'none') {
            const matches = bg.match(/url\((?:'|")?(.+?)(?:'|")?\)/g);
            if (matches) {
              matches.forEach(m => {
                const url = m.replace(/^url\((?:'|")?/, '').replace(/(?:'|")?\)$/, '');
                if (url && !url.startsWith('data:')) urls.add(url);
              });
            }
          }
        }
      }
      const list = Array.from(urls);
      this.imgTotal = list.length;
      this.imgLoaded = 0;
      this.update();
      if (this.imgTotal === 0) {
        setTimeout(() => this.finish(), 200);
        return;
      }
      list.forEach(url => {
        const img = new Image();
        img.onload = () => {
          this.imgLoaded++;
          this.update();
          if (this.imgLoaded >= this.imgTotal) this.finish();
        };
        img.onerror = () => {
          this.imgLoaded++;
          this.update();
          if (this.imgLoaded >= this.imgTotal) this.finish();
        };
        img.src = url;
      });
    }
  };

  window.CanLoader = CanLoader;
})();
