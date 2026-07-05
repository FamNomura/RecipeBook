(function () {
  'use strict';

  // ── LocalStorage Likes Manager ───────────────────────
  const LIKES_KEY = 'recipe-likes';

  function getLikes() {
    try {
      return JSON.parse(localStorage.getItem(LIKES_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveLikes(likes) {
    localStorage.setItem(LIKES_KEY, JSON.stringify(likes));
  }

  function getLikeCount(slug) {
    return getLikes()[slug] || 0;
  }

  function incrementLike(slug) {
    const likes = getLikes();
    likes[slug] = (likes[slug] || 0) + 1;
    saveLikes(likes);
    return likes[slug];
  }

  function updateLikeDisplays(slug, count) {
    document.querySelectorAll(`.like-btn[data-slug="${slug}"]`).forEach(btn => {
      const countEl = btn.querySelector('.like-count');
      if (countEl) countEl.textContent = count;
    });
  }

  function initLikeCounts() {
    const likes = getLikes();
    document.querySelectorAll('.like-btn[data-slug]').forEach(btn => {
      const slug = btn.dataset.slug;
      const count = likes[slug] || 0;
      const countEl = btn.querySelector('.like-count');
      if (countEl) countEl.textContent = count;
      if (count > 0) btn.classList.add('is-liked');
    });
  }

  window.toggleLike = function (slug, btnEl) {
    const count = incrementLike(slug);
    updateLikeDisplays(slug, count);
    btnEl.classList.add('is-liked');
    const icon = btnEl.querySelector('.like-icon');
    if (icon) {
      icon.style.animation = 'none';
      void icon.offsetHeight;
      icon.style.animation = '';
    }
  };

  // ══════════════════════════════════════════════════════
  //  INDEX PAGE LOGIC
  // ══════════════════════════════════════════════════════
  function initIndexPage() {
    const recipesGrid = document.getElementById('recipes-grid');
    if (!recipesGrid || typeof ALL_RECIPES === 'undefined') return;

    const searchInput = document.getElementById('search-input');
    const genreFilters = document.getElementById('genre-filters');
    const sortSelect = document.getElementById('sort-select');
    const emptyState = document.getElementById('empty-state');

    let currentGenre = 'all';
    let currentSearch = '';
    let currentSort = 'likes';

    function filterAndSort() {
      const cards = Array.from(recipesGrid.querySelectorAll('.recipe-card'));
      const likes = getLikes();
      let visibleCount = 0;

      const items = cards.map(card => {
        const slug = card.dataset.slug;
        const genres = JSON.parse(card.dataset.genres || '[]');
        const recipe = ALL_RECIPES.find(r => r.slug === slug);
        if (!recipe) return { card, visible: false };

        const matchGenre = currentGenre === 'all' || genres.includes(currentGenre);
        const matchSearch = !currentSearch ||
          recipe.searchText.toLowerCase().includes(currentSearch.toLowerCase());

        return {
          card,
          visible: matchGenre && matchSearch,
          likes: likes[slug] || 0,
          updated: recipe.updated,
          title: recipe.title
        };
      });

      items.sort((a, b) => {
        if (!a.visible && !b.visible) return 0;
        if (!a.visible) return 1;
        if (!b.visible) return -1;

        switch (currentSort) {
          case 'likes': return b.likes - a.likes;
          case 'updated': return b.updated.localeCompare(a.updated);
          case 'title': return a.title.localeCompare(b.title, 'ja');
          default: return 0;
        }
      });

      items.forEach(item => {
        if (item.visible) {
          item.card.style.display = '';
          visibleCount++;
        } else {
          item.card.style.display = 'none';
        }
        recipesGrid.appendChild(item.card);
      });

      emptyState.hidden = visibleCount > 0;
    }

    genreFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.genre-btn');
      if (!btn) return;
      genreFilters.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentGenre = btn.dataset.genre;
      filterAndSort();
    });

    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        filterAndSort();
      }, 200);
    });

    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      filterAndSort();
    });

    filterAndSort();
  }

  // ══════════════════════════════════════════════════════
  //  RECIPE PAGE LOGIC
  // ══════════════════════════════════════════════════════
  function initRecipePage() {
    if (typeof RECIPE_DATA === 'undefined') return;

    initWakeLock();
    initServingsControl();
    initIngredientsCheck();
    initInlineTimers();
    initAccordion();
    initRecipeLikeButton();
  }

  // ── 提案A: Wake Lock API (画面常時点灯) ────────────────
  let wakeLock = null;
  async function initWakeLock() {
    const statusBadge = document.getElementById('wakelock-status');
    if (!('wakeLock' in navigator)) return;

    async function requestWakeLock() {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        if (statusBadge) statusBadge.style.display = 'block';
      } catch (err) {
        if (statusBadge) statusBadge.style.display = 'none';
      }
    }

    await requestWakeLock();

    // タブ切り替えから戻ったときに再取得
    document.addEventListener('visibilitychange', async () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
      }
    });
  }

  // ── Servings Control & Scaling ────────────────────────
  function initServingsControl() {
    const decreaseBtn = document.getElementById('servings-decrease');
    const increaseBtn = document.getElementById('servings-increase');
    const countEl = document.getElementById('servings-count');
    if (!decreaseBtn || !increaseBtn || !countEl) return;

    const baseServings = RECIPE_DATA.servings;
    let currentServings = baseServings;

    function updateIngredients() {
      countEl.textContent = currentServings;
      const scale = currentServings / baseServings;

      document.querySelectorAll('.ingredient-quantity').forEach(el => {
        const baseValue = parseFloat(el.dataset.baseValue);
        if (isNaN(baseValue)) return;

        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const scaled = baseValue * scale;
        const formatted = formatNumber(scaled);

        el.textContent = prefix + formatted + suffix;
        el.classList.toggle('is-scaled', currentServings !== baseServings);
      });
    }

    decreaseBtn.addEventListener('click', () => {
      if (currentServings > 1) { currentServings--; updateIngredients(); }
    });
    increaseBtn.addEventListener('click', () => {
      if (currentServings < 20) { currentServings++; updateIngredients(); }
    });
  }

  function formatNumber(n) {
    if (n === 0) return '0';
    if (Number.isInteger(n)) return String(n);
    const fractions = [[1/4, '1/4'], [1/3, '1/3'], [1/2, '1/2'], [2/3, '2/3'], [3/4, '3/4']];
    const whole = Math.floor(n);
    const frac = n - whole;
    for (const [val, str] of fractions) {
      if (Math.abs(frac - val) < 0.01) return whole > 0 ? `${whole} ${str}` : str;
    }
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  // ── 提案B: 材料タップ消し込み (買い出し・準備対応) ─────
  function initIngredientsCheck() {
    const list = document.getElementById('ingredients-list');
    if (!list) return;

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.ingredient-item');
      if (item) {
        item.classList.toggle('is-checked');
      }
    });
  }

  // ── 提案C: 手順内タイマー ──────────────────────────────
  let timerInterval = null;
  let timerSecondsLeft = 0;
  let timerIsPaused = false;

  function initInlineTimers() {
    const stepsContainer = document.getElementById('steps-container');
    const overlay = document.getElementById('global-timer-overlay');
    const display = document.getElementById('global-timer-display');
    const pauseBtn = document.getElementById('timer-pause-btn');
    const cancelBtn = document.getElementById('timer-cancel-btn');
    const alarm = document.getElementById('timer-alarm-sound');

    if (!stepsContainer || !overlay) return;

    // 手順テキスト内の「〇分」「〇秒」をリンク化
    const bodyEls = stepsContainer.querySelectorAll('.step-body');
    bodyEls.forEach(el => {
      let html = el.innerHTML;
      // 「5分」「1分30秒」「40秒」のパターンにマッチ
      const regex = /(\d+分(?:半|\d+秒)?|\d+秒)/g;
      html = html.replace(regex, (match) => {
        return `<span class="timer-link" data-duration="${match}">${match}</span>`;
      });
      el.innerHTML = html;
    });

    // タイマーリンクのクリックイベント
    stepsContainer.addEventListener('click', (e) => {
      const link = e.target.closest('.timer-link');
      if (!link) return;

      const durationStr = link.dataset.duration;
      let totalSeconds = 0;

      const minMatch = durationStr.match(/(\d+)分/);
      const secMatch = durationStr.match(/(\d+)秒/);

      if (minMatch) totalSeconds += parseInt(minMatch[1]) * 60;
      if (durationStr.includes('分半')) totalSeconds += 30;
      if (secMatch) totalSeconds += parseInt(secMatch[1]);

      startGlobalTimer(totalSeconds);
    });

    function startGlobalTimer(seconds) {
      clearInterval(timerInterval);
      if (alarm) { alarm.pause(); alarm.currentTime = 0; }
      
      timerSecondsLeft = seconds;
      timerIsPaused = false;
      if (pauseBtn) pauseBtn.textContent = '一時停止';
      
      overlay.hidden = false;
      updateTimerDisplay();

      timerInterval = setInterval(() => {
        if (!timerIsPaused) {
          timerSecondsLeft--;
          updateTimerDisplay();

          if (timerSecondsLeft <= 0) {
            clearInterval(timerInterval);
            if (alarm) alarm.play();
            if (pauseBtn) pauseBtn.textContent = '止める';
          }
        }
      }, 1000);
    }

    function updateTimerDisplay() {
      const m = Math.floor(timerSecondsLeft / 60);
      const s = timerSecondsLeft % 60;
      if (display) {
        display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (timerSecondsLeft <= 0) {
          // アラーム停止処理
          if (alarm) { alarm.pause(); alarm.currentTime = 0; }
          overlay.hidden = true;
          clearInterval(timerInterval);
          return;
        }
        timerIsPaused = !timerIsPaused;
        pauseBtn.textContent = timerIsPaused ? '再開' : '一時停止';
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        clearInterval(timerInterval);
        if (alarm) { alarm.pause(); alarm.currentTime = 0; }
        overlay.hidden = true;
      });
    }
  }

  // ── 提案D & ② & 全開閉: アコーディオン制御 ──────────
  function initAccordion() {
    const container = document.getElementById('steps-container');
    const progressBar = document.getElementById('progress-bar');
    const toggleAllBtn = document.getElementById('steps-toggle-all-btn');
    if (!container) return;

    const steps = Array.from(container.querySelectorAll('.step-item'));
    const totalSteps = steps.length;
    let completedSteps = 0;

    function updateProgress() {
      const pct = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
      if (progressBar) progressBar.style.width = pct + '%';
    }

    function toggleStep(stepEl, open) {
      const content = stepEl.querySelector('.step-content');
      const header = stepEl.querySelector('.step-header');
      if (!content || !header) return;

      if (open) {
        // ② 完了状態の解除（開き直した時）
        if (stepEl.classList.contains('is-done')) {
          stepEl.classList.remove('is-done');
          const statusEl = stepEl.querySelector('.step-status');
          if (statusEl) statusEl.textContent = '';
          completedSteps = Math.max(0, completedSteps - 1);
          updateProgress();
        }

        stepEl.classList.add('is-active');
        content.hidden = false;
        header.setAttribute('aria-expanded', 'true');
      } else {
        stepEl.classList.remove('is-active');
        content.hidden = true;
        header.setAttribute('aria-expanded', 'false');
      }
      updateToggleAllButtonText();
    }

    function openNextStep(currentIndex) {
      for (let i = currentIndex + 1; i < steps.length; i++) {
        if (!steps[i].classList.contains('is-done')) {
          toggleStep(steps[i], true);
          // 提案D: スムーズスクロール追従
          setTimeout(() => {
            steps[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
          return;
        }
      }
    }

    function updateToggleAllButtonText() {
      if (!toggleAllBtn) return;
      const anyActive = steps.some(s => s.classList.contains('is-active'));
      toggleAllBtn.textContent = anyActive ? '全て閉じる' : '全て開く';
    }

    // 全開閉ボタンイベント
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const anyActive = steps.some(s => s.classList.contains('is-active'));
        steps.forEach(s => toggleStep(s, !anyActive));
      });
    }

    container.addEventListener('click', (e) => {
      const header = e.target.closest('.step-header');
      if (header) {
        const stepEl = header.closest('.step-item');
        const isActive = stepEl.classList.contains('is-active');
        toggleStep(stepEl, !isActive);
        return;
      }

      const completeBtn = e.target.closest('.step-complete-btn');
      if (completeBtn) {
        const stepEl = completeBtn.closest('.step-item');
        const stepIndex = parseInt(stepEl.dataset.step);

        if (!stepEl.classList.contains('is-done')) {
          stepEl.classList.add('is-done');
          const statusEl = stepEl.querySelector('.step-status');
          if (statusEl) statusEl.textContent = '✓';
          completedSteps++;
          updateProgress();

          toggleStep(stepEl, false);
          openNextStep(stepIndex);
        }
      }
    });
  }

  function initRecipeLikeButton() {
    const btn = document.getElementById('recipe-like-btn');
    if (!btn) return;

    const slug = btn.dataset.slug;
    const countEl = document.getElementById('recipe-like-count');

    const count = getLikeCount(slug);
    if (countEl) countEl.textContent = count;
    if (count > 0) btn.classList.add('is-liked');

    btn.addEventListener('click', () => {
      const newCount = incrementLike(slug);
      if (countEl) countEl.textContent = newCount;
      btn.classList.add('is-liked');
      const icon = btn.querySelector('.like-icon');
      if (icon) {
        icon.style.animation = 'none';
        void icon.offsetHeight;
        icon.style.animation = '';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLikeCounts();
    initIndexPage();
    initRecipePage();
  });

})();
