/* ═══════════════════════════════════════════════════════
   レシピブック – Client-side JavaScript
   Handles: likes, genre filter, search, sort,
            servings adjustment, accordion steps
   ═══════════════════════════════════════════════════════ */

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

  // ── Update all like count displays for a given slug ──
  function updateLikeDisplays(slug, count) {
    document.querySelectorAll(`.like-btn[data-slug="${slug}"]`).forEach(btn => {
      const countEl = btn.querySelector('.like-count');
      if (countEl) countEl.textContent = count;
    });
  }

  // ── Initialize like counts on page load ──────────────
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

  // Global function for inline onclick on index cards
  window.toggleLike = function (slug, btnEl) {
    const count = incrementLike(slug);
    updateLikeDisplays(slug, count);
    btnEl.classList.add('is-liked');
    // Re-trigger animation
    const icon = btnEl.querySelector('.like-icon');
    if (icon) {
      icon.style.animation = 'none';
      // Force reflow
      void icon.offsetHeight;
      icon.style.animation = '';
    }
  };

  // ══════════════════════════════════════════════════════
  //  INDEX PAGE LOGIC
  // ══════════════════════════════════════════════════════

  function initIndexPage() {
    if (typeof ALL_RECIPES === 'undefined') return;

    const searchInput = document.getElementById('search-input');
    const genreFilters = document.getElementById('genre-filters');
    const sortSelect = document.getElementById('sort-select');
    const recipesGrid = document.getElementById('recipes-grid');
    const emptyState = document.getElementById('empty-state');

    let currentGenre = 'all';
    let currentSearch = '';
    let currentSort = 'likes';

    // ── Filter & Sort ────────────────────────────────
    function filterAndSort() {
      const cards = Array.from(recipesGrid.querySelectorAll('.recipe-card'));
      const likes = getLikes();
      let visibleCount = 0;

      // Build filtered list with sort data
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

      // Sort
      items.sort((a, b) => {
        if (!a.visible && !b.visible) return 0;
        if (!a.visible) return 1;
        if (!b.visible) return -1;

        switch (currentSort) {
          case 'likes':
            return b.likes - a.likes;
          case 'updated':
            return b.updated.localeCompare(a.updated);
          case 'title':
            return a.title.localeCompare(b.title, 'ja');
          default:
            return 0;
        }
      });

      // Apply order and visibility
      items.forEach(item => {
        if (item.visible) {
          item.card.style.display = '';
          item.card.style.order = '';
          visibleCount++;
        } else {
          item.card.style.display = 'none';
        }
        recipesGrid.appendChild(item.card);
      });

      emptyState.hidden = visibleCount > 0;
    }

    // ── Genre filter click ───────────────────────────
    genreFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.genre-btn');
      if (!btn) return;

      genreFilters.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentGenre = btn.dataset.genre;
      filterAndSort();
    });

    // ── Search input ─────────────────────────────────
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        filterAndSort();
      }, 200);
    });

    // ── Sort change ──────────────────────────────────
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      filterAndSort();
    });

    // Initial sort
    filterAndSort();
  }

  // ══════════════════════════════════════════════════════
  //  RECIPE PAGE LOGIC
  // ══════════════════════════════════════════════════════

  function initRecipePage() {
    if (typeof RECIPE_DATA === 'undefined') return;

    initServingsControl();
    initAccordion();
    initRecipeLikeButton();
  }

  // ── Servings Control & Ingredient Scaling ──────────
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
        if (isNaN(baseValue)) return; // Non-numeric, keep original

        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const scaled = baseValue * scale;
        const formatted = formatNumber(scaled);

        el.textContent = prefix + formatted + suffix;
        el.classList.toggle('is-scaled', currentServings !== baseServings);
      });
    }

    decreaseBtn.addEventListener('click', () => {
      if (currentServings > 1) {
        currentServings--;
        updateIngredients();
      }
    });

    increaseBtn.addEventListener('click', () => {
      if (currentServings < 20) {
        currentServings++;
        updateIngredients();
      }
    });
  }

  // ── Number Formatting (fractions, decimals) ────────
  function formatNumber(n) {
    if (n === 0) return '0';

    // Check if it's a whole number
    if (Number.isInteger(n)) return String(n);

    // Check common fractions
    const fractions = [
      [1/4, '1/4'], [1/3, '1/3'], [1/2, '1/2'],
      [2/3, '2/3'], [3/4, '3/4']
    ];

    const whole = Math.floor(n);
    const frac = n - whole;

    for (const [val, str] of fractions) {
      if (Math.abs(frac - val) < 0.01) {
        return whole > 0 ? `${whole} ${str}` : str;
      }
    }

    // Round to 1 decimal
    const rounded = Math.round(n * 10) / 10;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(1);
  }

  // ── Accordion Steps ────────────────────────────────
  function initAccordion() {
    const container = document.getElementById('steps-container');
    const progressBar = document.getElementById('progress-bar');
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
        stepEl.classList.add('is-active');
        content.hidden = false;
        header.setAttribute('aria-expanded', 'true');
      } else {
        stepEl.classList.remove('is-active');
        content.hidden = true;
        header.setAttribute('aria-expanded', 'false');
      }
    }

    function openNextStep(currentIndex) {
      for (let i = currentIndex + 1; i < steps.length; i++) {
        if (!steps[i].classList.contains('is-done')) {
          toggleStep(steps[i], true);
          // Smooth scroll to next step
          steps[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
      }
    }

    // Header click – toggle
    container.addEventListener('click', (e) => {
      const header = e.target.closest('.step-header');
      if (header) {
        const stepEl = header.closest('.step-item');
        const isActive = stepEl.classList.contains('is-active');
        toggleStep(stepEl, !isActive);
        return;
      }

      // Complete button click
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

          // Close current, open next
          toggleStep(stepEl, false);
          openNextStep(stepIndex);
        }
      }
    });
  }

  // ── Recipe Page Like Button ────────────────────────
  function initRecipeLikeButton() {
    const btn = document.getElementById('recipe-like-btn');
    if (!btn) return;

    const slug = btn.dataset.slug;
    const countEl = document.getElementById('recipe-like-count');

    // Init count
    const count = getLikeCount(slug);
    if (countEl) countEl.textContent = count;
    if (count > 0) btn.classList.add('is-liked');

    btn.addEventListener('click', () => {
      const newCount = incrementLike(slug);
      if (countEl) countEl.textContent = newCount;
      btn.classList.add('is-liked');

      // Re-trigger animation
      const icon = btn.querySelector('.like-icon');
      if (icon) {
        icon.style.animation = 'none';
        void icon.offsetHeight;
        icon.style.animation = '';
      }
    });
  }

  // ══════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', () => {
    initLikeCounts();
    initIndexPage();
    initRecipePage();
  });

})();
