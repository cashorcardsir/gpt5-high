// cup-loader.js
(() => {
  'use strict';

  const DEFAULTS = {
    color: '#ff7a00',          // main liquid color
    background: 'rgba(18, 18, 20, 0.92)', // overlay bg
    textColor: '#ffffff',      // percentage text
    showPercentage: true,
    includeBackgroundImages: true,
    zIndex: 999999,
    minDuration: 300,          // ms, minimum visible time to avoid flash
    waveSpeedSec: 3.5          // horizontal wave speed
  };

  function lighten(hex, pct = 25) {
    // Simple hex lighten (0-100)
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

  const CupLoader = {
    opts: { ...DEFAULTS },
    overlayEl: null,
    percentEl: null,
    fillLevelEl: null,
    cupClipRect: null,
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

      // Begin tracking
      this.trackDOMReady();
      this.trackFonts();
      this.trackImages();

      // Safety: ensure we finish at window load even if something isn’t counted
      window.addEventListener('load', () => this.finish());
    },

    injectStyles() {
      const style = document.createElement('style');
      style.setAttribute('data-cup-loader', 'true');
      style.textContent = `
        .cup-loader-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${this.opts.background};
          z-index: ${this.opts.zIndex};
          transition: opacity 400ms ease;
        }
        .cup-loader-overlay.hide {
          opacity: 0;
          pointer-events: none;
        }
        .cup-loader {
          text-align: center;
          color: ${this.opts.textColor};
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
          user-select: none;
        }
        .cup-percent {
          margin-top: 12px;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0.4px;
        }

        /* Wave animation on the inner group */
        .wave-shift {
          transform-box: fill-box;
          animation: cup-wave ${this.opts.waveSpeedSec}s linear infinite;
        }
        @keyframes cup-wave {
          from { transform: translateX(0); }
          to   { transform: translateX(-200px); }
        }

        /* Smooth fill movement */
        .fill-level {
          transform-box: fill-box;
          transition: transform 420ms cubic-bezier(.22,.61,.36,1);
        }

        /* Respect reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .wave-shift { animation: none; }
          .fill-level { transition: none; }
        }
      `;
      document.head.appendChild(style);
    },

    buildDOM() {
      const overlay = document.createElement('div');
      overlay.className = 'cup-loader-overlay';
      overlay.setAttribute('aria-hidden', 'true');

      // SVG cup with a rectangular cup body (rounded corners) and wave inside via clipPath
      const cupColor = this.opts.color;
      const foamColor = lighten(cupColor, 30);

      overlay.innerHTML = `
        <div class="cup-loader">
          <svg width="220" height="240" viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" aria-label="Loading cup">
            <!-- Cup body for clip -->
            <defs>
              <clipPath id="cupClip">
                <rect id="cupClipRect" x="30" y="25" width="140" height="150" rx="22" ry="22"></rect>
              </clipPath>
            </defs>

            <!-- Cup outline and handle (decorative) -->
            <rect x="30" y="25" width="140" height="150" rx="22" ry="22" fill="none" stroke="#e2e2e6" stroke-width="3"/>
            <path d="M172,60 q22,16 0,40 q-12,14 -26,0" fill="none" stroke="#e2e2e6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>

            <!-- Liquid clipped to cup body -->
            <g clip-path="url(#cupClip)">
              <!-- Container that moves vertically according to progress -->
              <g class="fill-level" style="transform: translateY(130px);">
                <!-- Horizontal wave movement -->
                <g class="wave-shift">
                  <!-- Main wave (wide path, closed at bottom) -->
                  <path d="M -200 40 
                           Q -175 20 -150 40 T -100 40 T -50 40 T 0 40 T 50 40 T 100 40 T 150 40 T 200 40 T 250 40 T 300 40 T 350 40 T 400 40
                           L 400 220 L -200 220 Z"
                        fill="${cupColor}" opacity="0.92"></path>
                  <!-- Highlight foam wave slightly above -->
                  <path d="M -200 35 
                           Q -175 20 -150 35 T -100 35 T -50 35 T 0 35 T 50 35 T 100 35 T 150 35 T 200 35 T 250 35 T 300 35 T 350 35 T 400 35
                           L 400 220 L -200 220 Z"
                        fill="${foamColor}" opacity="0.65"></path>
                </g>
              </g>
            </g>
          </svg>
          <div class="cup-percent">${this.opts.showPercentage ? '0%' : ''}</div>
        </div>
      `;

      document.body.appendChild(overlay);

      this.overlayEl = overlay;
      this.percentEl = overlay.querySelector('.cup-percent');
      this.fillLevelEl = overlay.querySelector('.fill-level');
      this.cupClipRect = overlay.querySelector('#cupClipRect');
    },

    // Progress calculation
    computeProgress() {
      const domPart   = this.domDone   ? WEIGHTS.dom   : 0;
      const fontPart  = this.fontsDone ? WEIGHTS.fonts : 0;
      const imgPart   = this.imgTotal > 0 ? WEIGHTS.imgs * (this.imgLoaded / this.imgTotal) : 0;
      let progress = domPart + fontPart + imgPart;

      // Clamp to 99 until finish() or full accounted
      if (progress >= 99 && !this.finished) progress = 99;
      return Math.min(100, Math.max(0, Math.round(progress)));
    },

    applyProgress(pct) {
      // Update text
      if (this.percentEl && this.opts.showPercentage) {
        this.percentEl.textContent = `${pct}%`;
      }
      // Update fill vertical position
      // We want the wave crest to move from near bottom to top of the cup rect.
      const rectY = parseFloat(this.cupClipRect.getAttribute('y'));       // 25
      const rectH = parseFloat(this.cupClipRect.getAttribute('height'));  // 150
      const crestLocalY = 40;  // crest y in the wave path
      // Position crest at: rectY + rectH - (pct/100)*rectH
      // So translateY = desiredY - crestLocalY
      const desiredY = rectY + rectH - (pct / 100) * rectH;
      const tY = desiredY - crestLocalY; // pixels
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

      // Force 100%
      this.applyProgress(100);

      // Respect minimum display time to avoid flash
      const elapsed = performance.now() - this.startTime;
      const remaining = Math.max(0, this.opts.minDuration - elapsed);

      setTimeout(() => {
        this.overlayEl.classList.add('hide');
        setTimeout(() => {
          // Remove from DOM to keep things clean
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
          // If fonts fail or unsupported, continue
          this.fontsDone = true;
          this.update();
        });
      } else {
        // Not supported; consider fonts done
        this.fontsDone = true;
        this.update();
      }
    },

    trackImages() {
      // Gather image URLs
      const urls = new Set();

      // <img> tags
      document.querySelectorAll('img').forEach(img => {
        const src = img.currentSrc || img.src;
        if (src) urls.add(src);
      });

      // CSS background images
      if (this.opts.includeBackgroundImages) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const bg = getComputedStyle(el).getPropertyValue('background-image');
          if (bg && bg !== 'none') {
            const matches = bg.match(/url\((?:'|")?(.+?)(?:'|")?\)/g);
            if (matches) {
              matches.forEach(m => {
                const url = m.replace(/^url\((?:'|")?/, '').replace(/(?:'|")?\)$/, '');
                if (url && !url.startsWith('data:')) {
                  urls.add(url);
                }
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
        // No images to wait for; finish at window load or soon after DOM & fonts
        // Give a tiny moment so the wave has time to animate a bit
        setTimeout(() => this.finish(), 200);
        return;
      }

      // Preload images to track their load progress
      list.forEach(url => {
        const img = new Image();
        img.onload = () => {
          this.imgLoaded++;
          this.update();
          if (this.imgLoaded >= this.imgTotal) this.finish();
        };
        img.onerror = () => {
          // Count errors as loaded so progress isn't stuck
          this.imgLoaded++;
          this.update();
          if (this.imgLoaded >= this.imgTotal) this.finish();
        };
        // Avoid blocking; start loading
        img.src = url;
      });
    }
  };

  // Expose global
  window.CupLoader = CupLoader;
})();
