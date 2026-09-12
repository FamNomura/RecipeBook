const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const ROOT_DIR = path.resolve(__dirname, '..');
const RECIPES_DIR = path.join(ROOT_DIR, 'recipes');
const RECIPES_IMG_DIR = path.join(RECIPES_DIR, 'img');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DOCS_IMG_DIR = path.join(DOCS_DIR, 'recipes', 'img');

// ディレクトリ初期化
function initDirectories() {
  if (fs.existsSync(DOCS_DIR)) {
    fs.rmSync(DOCS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.mkdirSync(path.join(DOCS_DIR, 'css'), { recursive: true });
  fs.mkdirSync(path.join(DOCS_DIR, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DOCS_DIR, 'recipes'), { recursive: true });
  fs.mkdirSync(DOCS_IMG_DIR, { recursive: true });
}

// 静的アセットのコピー (admin.html, admin.css, admin.js を含む)
function copyStaticAssets() {
  // CSS
  const cssSrc = path.join(SRC_DIR, 'css');
  if (fs.existsSync(cssSrc)) {
    fs.readdirSync(cssSrc).forEach(file => {
      fs.copyFileSync(path.join(cssSrc, file), path.join(DOCS_DIR, 'css', file));
    });
  }

  // JS
  const jsSrc = path.join(SRC_DIR, 'js');
  if (fs.existsSync(jsSrc)) {
    fs.readdirSync(jsSrc).forEach(file => {
      fs.copyFileSync(path.join(jsSrc, file), path.join(DOCS_DIR, 'js', file));
    });
  }

  // admin.html のコピー
  const adminHtmlSrc = path.join(SRC_DIR, 'admin.html');
  if (fs.existsSync(adminHtmlSrc)) {
    fs.copyFileSync(adminHtmlSrc, path.join(DOCS_DIR, 'admin.html'));
  }

  // レシピ画像 (recipes/img/ -> docs/recipes/img/)
  if (fs.existsSync(RECIPES_IMG_DIR)) {
    fs.readdirSync(RECIPES_IMG_DIR).forEach(file => {
      fs.copyFileSync(path.join(RECIPES_IMG_DIR, file), path.join(DOCS_IMG_DIR, file));
    });
  }
}

// 数値・単位の分離パース（人数変更スケーリング用）
function parseQuantity(qtyStr) {
  if (!qtyStr) return { baseValue: null, prefix: '', suffix: '' };
  const trimmed = qtyStr.trim();

  // "大さじ1.5", "小さじ1/2" のようなプレフィックス付き
  const prefixMatch = trimmed.match(/^(大さじ|小さじ|少々|適量)?\s*(\d+(?:\.\d+)?|\d+\/\d+)?(.*)$/);
  if (!prefixMatch) return { baseValue: null, prefix: '', suffix: trimmed };

  const prefix = prefixMatch[1] || '';
  const numStr = prefixMatch[2];
  const suffix = prefixMatch[3] || '';

  if (!numStr) {
    return { baseValue: null, prefix: trimmed, suffix: '' };
  }

  let num = 0;
  if (numStr.includes('/')) {
    const [numerator, denominator] = numStr.split('/').map(Number);
    num = denominator ? numerator / denominator : 0;
  } else {
    num = parseFloat(numStr);
  }

  return { baseValue: num, prefix, suffix };
}

// HTMLエスケープ
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// レシピ個別ページのパース
function parseRecipeMarkdown(fileContent, slug) {
  const { data, content } = matter(fileContent);

  // 材料ブロック抽出
  const ingredients = [];
  const ingMatch = content.match(/## 材料\s*\n([\s\S]*?)(?=\n## 手順|$)/);
  if (ingMatch) {
    const lines = ingMatch[1].split('\n');
    let currentGroup = null;

    lines.forEach(line => {
      const groupMatch = line.match(/^###\s*【?(.+?)】?$/);
      if (groupMatch) {
        currentGroup = groupMatch[1].trim();
        return;
      }
      const itemMatch = line.match(/^-\s*([^:]+):\s*(.+)$/);
      if (itemMatch) {
        const name = itemMatch[1].trim();
        const rawQty = itemMatch[2].trim();
        const parsed = parseQuantity(rawQty);
        ingredients.push({
          group: currentGroup,
          name,
          rawQty,
          baseValue: parsed.baseValue,
          prefix: parsed.prefix,
          suffix: parsed.suffix
        });
      }
    });
  }

  // 手順ブロック抽出
  const steps = [];
  const stepsMatch = content.match(/## 手順\s*\n([\s\S]*)$/);
  if (stepsMatch) {
    const stepBlocks = stepsMatch[1].split(/(?=^###\s+)/m);
    stepBlocks.forEach(block => {
      const titleMatch = block.match(/^###\s+(.+)$/m);
      if (!titleMatch) return;

      const title = titleMatch[1].trim();
      const bodyLines = block.replace(/^###\s+.+$/m, '').trim().split('\n');
      let pointText = '';
      const normalLines = [];

      bodyLines.forEach(l => {
        const pMatch = l.match(/^(?:>\s*\*\*ポイント\*\*|ポイント):\s*(.*)$/);
        if (pMatch) {
          pointText = pMatch[1].trim();
        } else if (l.trim()) {
          normalLines.push(l);
        }
      });

      const bodyHtml = marked.parse(normalLines.join('\n'));
      steps.push({
        title,
        bodyHtml,
        point: pointText
      });
    });
  }

  // 画像探索
  const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
  let completeImage = null;
  let thumbImage = null;

  for (const ext of extensions) {
    if (!completeImage && fs.existsSync(path.join(RECIPES_IMG_DIR, `${slug}_complete${ext}`))) {
      completeImage = `recipes/img/${slug}_complete${ext}`;
    }
    if (!thumbImage && fs.existsSync(path.join(RECIPES_IMG_DIR, `${slug}_thumb${ext}`))) {
      thumbImage = `recipes/img/${slug}_thumb${ext}`;
    }
  }

  // サムネイルが無ければ完成写真でフォールバック
  if (!thumbImage && completeImage) {
    thumbImage = completeImage;
  }

  const genres = data.genre
    ? data.genre.split(',').map(g => g.trim()).filter(Boolean)
    : [];

  return {
    slug,
    title: data.title || slug,
    source: data.source || '',
    genres,
    description: data.description || '',
    servings: parseInt(data.servings, 10) || 2,
    updated: data.updated || '',
    ingredients,
    steps,
    completeImage,
    thumbImage,
    rawContent: content
  };
}

// レシピ個別HTML生成
function renderRecipeHtml(recipe) {
  let ingredientsHtml = '';
  let lastGroup = null;

  recipe.ingredients.forEach(item => {
    if (item.group && item.group !== lastGroup) {
      ingredientsHtml += `
        <div class="ingredient-group-heading">
          <h3>${escapeHtml(item.group)}</h3>
        </div>
      `;
      lastGroup = item.group;
    }

    const baseValAttr = item.baseValue !== null ? `data-base-value="${item.baseValue}"` : '';
    const prefixAttr = item.prefix ? `data-prefix="${escapeHtml(item.prefix)}"` : '';
    const suffixAttr = item.suffix ? `data-suffix="${escapeHtml(item.suffix)}"` : '';

    ingredientsHtml += `
      <li class="ingredient-item">
        <span class="ingredient-name">${escapeHtml(item.name)}</span>
        <span class="ingredient-quantity" ${baseValAttr} ${prefixAttr} ${suffixAttr}>${escapeHtml(item.rawQty)}</span>
      </li>
    `;
  });

  let stepsHtml = '';
  recipe.steps.forEach((step, idx) => {
    const pointHtml = step.point ? `
      <div class="step-point">
        <span class="step-point-icon">💡</span>
        <div class="step-point-text">${escapeHtml(step.point)}</div>
      </div>
    ` : '';

    stepsHtml += `
      <div class="step-item is-active" data-step="${idx}">
        <button type="button" class="step-header" aria-expanded="true">
          <span class="step-number">${idx + 1}</span>
          <span class="step-title-text">${escapeHtml(step.title)}</span>
          <span class="step-status"></span>
          <span class="step-chevron">▼</span>
        </button>
        <div class="step-content">
          <div class="step-body">${step.bodyHtml}</div>
          ${pointHtml}
          <button type="button" class="step-complete-btn">完了して次へ</button>
        </div>
      </div>
    `;
  });

  const heroImgHtml = recipe.completeImage
    ? `<img src="${recipe.completeImage}" alt="${escapeHtml(recipe.title)}" class="recipe-hero-img">`
    : `<div class="recipe-hero-placeholder">🍽️</div>`;

  const genresBadges = recipe.genres
    .map(g => `<span class="genre-badge">${escapeHtml(g)}</span>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(recipe.title)} - レシピブック</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="index.html" class="back-link">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        <span>一覧へ戻る</span>
      </a>
      <div class="header-actions">
        <button type="button" id="wakelock-status" class="wakelock-badge" title="画面の自動スリープ防止">◯ 常時点灯 OFF</button>
      </div>
    </div>
  </header>

  <main class="recipe-page">
    <article class="recipe-detail">
      <header class="recipe-header">
        <h1 class="recipe-title">
          ${escapeHtml(recipe.title)}
          ${recipe.source ? `<span class="recipe-title-source">（${escapeHtml(recipe.source)}）</span>` : ''}
        </h1>
        <div class="recipe-header-meta">
          <div class="recipe-genres">${genresBadges}</div>
          <button type="button" class="like-btn" id="recipe-like-btn" data-slug="${escapeHtml(recipe.slug)}">
            <span class="like-icon">♥</span>
            <span class="like-count" id="recipe-like-count">0</span>
          </button>
        </div>
      </header>

      <div class="recipe-hero">
        ${heroImgHtml}
      </div>

      ${recipe.description ? `<p class="recipe-description">${escapeHtml(recipe.description)}</p>` : ''}

      <section class="recipe-section">
        <div class="section-title-wrap">
          <h2 class="section-title">材料</h2>
        </div>
        <div class="servings-control">
          <button type="button" class="servings-btn" id="servings-decrease" aria-label="人数を減らす">−</button>
          <div class="servings-display"><span id="servings-count">${recipe.servings}</span>人前</div>
          <button type="button" class="servings-btn" id="servings-increase" aria-label="人数を増やす">＋</button>
        </div>
        <ul class="ingredients-list" id="ingredients-list">
          ${ingredientsHtml}
        </ul>
      </section>

      <section class="recipe-section">
        <div class="steps-section-header">
          <h2 class="section-title">作り方</h2>
          <button type="button" id="steps-toggle-all-btn" class="toggle-all-btn">全て閉じる</button>
        </div>
        <div class="progress-bar-wrapper">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <div class="steps-container" id="steps-container">
          ${stepsHtml}
        </div>
      </section>
    </article>
  </main>

  <!-- フローティングタイマー -->
  <div id="global-timer-overlay" class="timer-overlay" hidden>
    <div class="timer-box">
      <span class="timer-label">⏱️ タイマー</span>
      <div id="global-timer-display" class="timer-display">00:00</div>
      <div class="timer-controls">
        <button type="button" id="timer-pause-btn" class="timer-btn">一時停止</button>
        <button type="button" id="timer-cancel-btn" class="timer-btn cancel">✕</button>
      </div>
    </div>
    <audio id="timer-alarm-sound" preload="auto">
      <source src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" type="audio/mpeg">
    </audio>
  </div>

  <script>
    const RECIPE_DATA = {
      slug: "${recipe.slug}",
      servings: ${recipe.servings}
    };
  </script>
  <script src="js/app.js"></script>
</body>
</html>`;
}

// トップページ（一覧）HTML生成
function renderIndexHtml(recipes) {
  const allGenresSet = new Set();
  recipes.forEach(r => r.genres.forEach(g => allGenresSet.add(g)));
  const sortedGenres = Array.from(allGenresSet).sort((a, b) => a.localeCompare(b, 'ja'));

  const genreBtnsHtml = sortedGenres
    .map(g => `<button type="button" class="genre-btn" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`)
    .join('');

  const recipeCardsHtml = recipes.map(r => {
    const thumbHtml = r.thumbImage
      ? `<img src="${r.thumbImage}" alt="${escapeHtml(r.title)}" loading="lazy">`
      : `<div class="recipe-card-placeholder">🍽️</div>`;

    const genresHtml = r.genres
      .map(g => `<span class="recipe-card-genre">${escapeHtml(g)}</span>`)
      .join('');

    return `
      <a href="${r.slug}.html" class="recipe-card" data-slug="${escapeHtml(r.slug)}" data-genres='${JSON.stringify(r.genres)}'>
        <div class="recipe-card-image">
          ${thumbHtml}
        </div>
        <div class="recipe-card-body">
          <div class="recipe-card-genres">${genresHtml}</div>
          <h2 class="recipe-card-title">${escapeHtml(r.title)}</h2>
          <div class="recipe-card-meta">
            <span class="recipe-card-date">${escapeHtml(r.updated)}</span>
            <button type="button" class="like-btn" data-slug="${escapeHtml(r.slug)}" onclick="event.preventDefault(); window.toggleLike('${escapeHtml(r.slug)}', this);">
              <span class="like-icon">♥</span>
              <span class="like-count">0</span>
            </button>
          </div>
        </div>
      </a>
    `;
  }).join('');

  const jsonRecipes = JSON.stringify(recipes.map(r => ({
    slug: r.slug,
    title: r.title,
    genres: r.genres,
    updated: r.updated,
    searchText: `${r.title} ${r.genres.join(' ')} ${r.description} ${r.ingredients.map(i => i.name).join(' ')}`
  })));

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>レシピブック - My Recipe Book</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <h1 class="site-title"><a href="index.html">🍳 レシピブック</a></h1>
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" placeholder="料理名・材料で検索...">
      </div>
      <a href="admin.html" class="back-link" style="font-size:0.82rem; margin-left:8px;" title="レシピの追加・編集">⚙️ 管理</a>
    </div>
  </header>

  <nav class="genre-filter">
    <div class="genre-filter-scroll" id="genre-filters">
      <button type="button" class="genre-btn is-active" data-genre="all">すべて</button>
      ${genreBtnsHtml}
    </div>
  </nav>

  <div class="sort-bar">
    <label for="sort-select" class="sort-label">並び替え:</label>
    <select id="sort-select">
      <option value="likes">人気順（いいね）</option>
      <option value="updated">新着順</option>
      <option value="title">名前順</option>
    </select>
  </div>

  <main class="main-content">
    <div class="recipes-grid" id="recipes-grid">
      ${recipeCardsHtml}
    </div>
    <div class="empty-state" id="empty-state" hidden>
      <div class="empty-state-icon">🍽️</div>
      <p class="empty-state-text">該当するレシピが見つかりませんでした。</p>
    </div>
  </main>

  <script>
    const ALL_RECIPES = ${jsonRecipes};
  </script>
  <script src="js/app.js"></script>
</body>
</html>`;
}

// ── メインビルド実行 ──
function build() {
  console.log('🚀 ビルドを開始します...');
  initDirectories();
  copyStaticAssets();

  const mdFiles = fs.readdirSync(RECIPES_DIR)
    .filter(file => file.endsWith('.md'))
    .sort();

  const parsedRecipes = [];

  mdFiles.forEach(file => {
    const slug = path.basename(file, '.md');
    const content = fs.readFileSync(path.join(RECIPES_DIR, file), 'utf-8');
    const recipe = parseRecipeMarkdown(content, slug);
    parsedRecipes.push(recipe);

    // 各レシピHTML出力 (docs/[slug].html)
    const recipeHtml = renderRecipeHtml(recipe);
    fs.writeFileSync(path.join(DOCS_DIR, `${slug}.html`), recipeHtml, 'utf-8');
    console.log(`  ✓ 生成完了: docs/${slug}.html`);
  });

  // トップページ出力 (docs/index.html)
  const indexHtml = renderIndexHtml(parsedRecipes);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log('  ✓ 生成完了: docs/index.html');

  console.log(`✨ ビルド完了: 合計 ${parsedRecipes.length} 件のレシピを生成しました。`);
}

build();
