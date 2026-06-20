const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// ── Paths ───────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const RECIPES_DIR = path.join(ROOT, 'recipes');
const IMG_DIR = path.join(RECIPES_DIR, 'img');
const DOCS_DIR = path.join(ROOT, 'docs');
const SRC_DIR = path.join(ROOT, 'src');

// ── Utilities ───────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function imageExists(slug, suffix) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    if (fs.existsSync(path.join(IMG_DIR, `${slug}${suffix}${ext}`))) {
      return `${slug}${suffix}${ext}`;
    }
  }
  return null;
}

// ── Ingredient Parsing ──────────────────────────────────

function parseQuantity(str) {
  str = str.trim();

  // Mixed number: "1 1/2個"
  const mixedMatch = str.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
  if (mixedMatch) {
    const value = parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
    return { value, prefix: '', suffix: mixedMatch[4], original: str };
  }

  // Fraction only: "1/2個"
  const fracMatch = str.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (fracMatch) {
    const value = parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
    return { value, prefix: '', suffix: fracMatch[3], original: str };
  }

  // Prefix unit + number: "大さじ2", "小さじ1"
  const prefixMatch = str.match(/^([^\d]+?)(\d+(?:\.\d+)?)\s*(.*)$/);
  if (prefixMatch) {
    return {
      value: parseFloat(prefixMatch[2]),
      prefix: prefixMatch[1],
      suffix: prefixMatch[3],
      original: str
    };
  }

  // Number + suffix: "200g", "3個", "200ml"
  const numMatch = str.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (numMatch) {
    return {
      value: parseFloat(numMatch[1]),
      prefix: '',
      suffix: numMatch[2],
      original: str
    };
  }

  // Non-numeric: "適量", "少々"
  return { value: null, prefix: '', suffix: '', original: str };
}

function parseIngredients(mdBody) {
  const ingredients = [];
  const sectionMatch = mdBody.match(/##\s*材料\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!sectionMatch) return ingredients;

  const lines = sectionMatch[1].split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/^-\s+(.+?):\s*(.+)$/);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const quantityStr = itemMatch[2].trim();
      const parsed = parseQuantity(quantityStr);
      ingredients.push({ name, ...parsed });
    }
  }
  return ingredients;
}

// ── Step Parsing ────────────────────────────────────────

function parseSteps(mdBody, slug) {
  const steps = [];
  const sectionMatch = mdBody.match(/##\s*手順\s*\n([\s\S]*?)(?=\n##\s[^#]|$)/);
  if (!sectionMatch) return steps;

  // Ensure leading newline to correctly split the very first step
  const content = '\n' + sectionMatch[1];
  const stepBlocks = content.split(/\n###\s+/).filter(s => s.trim());

  stepBlocks.forEach((block, i) => {
    const lines = block.split('\n');
    const title = lines[0].trim();
    let body = '';
    let point = '';

    const bodyLines = [];
    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];
      // Match both "> **ポイント**:" and "ポイント:" or "> ポイント:"
      const pointMatch = line.match(/^(?:>\s*)?\*?\*?ポイント\*?\*?\s*:\s*(.+)$/);
      if (pointMatch) {
        point = pointMatch[1].trim();
      } else if (line.trim().startsWith('>') && point) {
        // Continue blockquote point text
        point += ' ' + line.replace(/^>\s*/, '').trim();
      } else {
        bodyLines.push(line);
      }
    }
    body = bodyLines.join('\n').trim();

    const stepNum = i + 1;
    const stepImage = imageExists(slug, `_step${stepNum}`);

    steps.push({
      title,
      body,
      bodyHtml: marked.parse(body),
      point,
      stepNum,
      hasImage: !!stepImage,
      imageName: stepImage
    });
  });

  return steps;
}

// ── HTML Generation ─────────────────────────────────────

function generateRecipeHtml(recipe) {
  const {
    slug, title, genres, description, servings, updated,
    ingredients, steps, hasCompleteImage, completeImageName
  } = recipe;

  const ingredientItems = ingredients.map((ing, i) => `
            <li class="ingredient-item" data-index="${i}">
              <span class="ingredient-name">${ing.name}</span>
              <span class="ingredient-quantity"
                    data-base-value="${ing.value !== null ? ing.value : ''}"
                    data-prefix="${escHtml(ing.prefix)}"
                    data-suffix="${escHtml(ing.suffix)}"
                    data-original="${escHtml(ing.original)}">${escHtml(ing.original)}</span>
            </li>`).join('\n');

  const stepItems = steps.map((step, i) => `
          <div class="step-item is-active" data-step="${i}">
            <button class="step-header" aria-expanded="true">
              <span class="step-number">${i + 1}</span>
              <span class="step-title-text">${escHtml(step.title)}</span>
              <span class="step-status"></span>
              <span class="step-chevron">▼</span>
            </button>
            <div class="step-content">
              <div class="step-body">${step.bodyHtml}</div>
              ${step.hasImage ? `<img src="../img/${step.imageName}" alt="手順${step.stepNum}" class="step-image" loading="lazy" onerror="this.style.display='none'">` : ''}
              ${step.point ? `<div class="step-point"><span class="step-point-icon">💡</span><span class="step-point-text">${escHtml(step.point)}</span></div>` : ''}
              <button class="step-complete-btn" aria-label="この手順を完了">完了 ✓</button>
            </div>
          </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} | レシピブック</title>
  <meta name="description" content="${escHtml(description)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="../index.html" class="back-link" aria-label="一覧に戻る">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 16l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        一覧に戻る
      </a>
    </div>
  </header>

  <main class="recipe-page">
    <article class="recipe-article">
      <div class="recipe-header">
        <h1 class="recipe-title" id="recipe-title">${escHtml(title)}</h1>
        <div class="recipe-header-meta">
          ${genres.map(g => `<span class="genre-badge">${escHtml(g)}</span>`).join('\n')}
          <button class="like-btn" id="recipe-like-btn" data-slug="${slug}" aria-label="いいね">
            <span class="like-icon">♥</span>
            <span class="like-count" id="recipe-like-count">0</span>
          </button>
        </div>
      </div>

      <div class="recipe-hero" id="recipe-hero">
        ${hasCompleteImage
          ? `<img src="../img/${completeImageName}" alt="${escHtml(title)}" class="recipe-hero-img" onerror="this.parentElement.innerHTML='<div class=\\'recipe-hero-placeholder\\'>🍽️</div>'">`
          : '<div class="recipe-hero-placeholder">🍽️</div>'}
      </div>

      <p class="recipe-description" id="recipe-description">${escHtml(description)}</p>

      <section class="recipe-section" id="ingredients-section">
        <h2 class="section-title">材料</h2>
        <div class="servings-control">
          <button class="servings-btn" id="servings-decrease" aria-label="人数を減らす">−</button>
          <span class="servings-display"><span id="servings-count">${servings}</span>人前</span>
          <button class="servings-btn" id="servings-increase" aria-label="人数を増やす">＋</button>
        </div>
        <ul class="ingredients-list" id="ingredients-list">
${ingredientItems}
        </ul>
      </section>

      <section class="recipe-section" id="steps-section">
        <h2 class="section-title">作り方</h2>
        <div class="progress-bar-wrapper">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <div class="steps-container" id="steps-container">
${stepItems}
        </div>
      </section>
    </article>
  </main>

  <script>
    const RECIPE_DATA = ${JSON.stringify({
      slug, title, genres, description, servings, updated,
      ingredients, steps: steps.map(s => ({ title: s.title, point: s.point, stepNum: s.stepNum, hasImage: s.hasImage }))
    })};
  </script>
  <script src="../js/app.js"></script>
</body>
</html>`;
}

function generateIndexHtml(recipes, genres) {
  const recipeCards = recipes.map(r => {
    const thumbHtml = r.hasThumbnail
      ? `<img src="img/${r.thumbnailName}" alt="${escHtml(r.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'recipe-card-placeholder\\'>🍽️</div>'">`
      : '<div class="recipe-card-placeholder">🍽️</div>';

    const dateStr = r.updated.replace(/-/g, '/');
    const genreBadges = r.genres.map(g => `<span class="recipe-card-genre">${escHtml(g)}</span>`).join('\n');

    return `
        <a href="recipes/${r.slug}.html" class="recipe-card" data-slug="${r.slug}" data-genres='${JSON.stringify(r.genres)}'>
          <div class="recipe-card-image">${thumbHtml}</div>
          <div class="recipe-card-body">
            <div class="recipe-card-genres">${genreBadges}</div>
            <h2 class="recipe-card-title">${escHtml(r.title)}</h2>
            <div class="recipe-card-meta">
              <button class="like-btn" data-slug="${r.slug}" aria-label="いいね" onclick="event.preventDefault(); event.stopPropagation(); toggleLike('${r.slug}', this);">
                <span class="like-icon">♥</span>
                <span class="like-count">0</span>
              </button>
              <time class="recipe-card-date" datetime="${r.updated}">${dateStr}</time>
            </div>
          </div>
        </a>`;
  }).join('\n');

  const genreBtns = ['すべて', ...genres].map((g, i) =>
    `<button class="genre-btn${i === 0 ? ' is-active' : ''}" data-genre="${i === 0 ? 'all' : escHtml(g)}">${escHtml(g)}</button>`
  ).join('\n            ');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>レシピブック</title>
  <meta name="description" content="お気に入りのレシピコレクション。和食・洋食・中華など、ジャンル別にレシピを検索・管理できます。">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <h1 class="site-title">🍳 レシピブック</h1>
      <div class="search-wrapper">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" stroke-width="2"/><path d="M12 12l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="search" id="search-input" placeholder="レシピ名・材料で検索..." aria-label="レシピ検索">
      </div>
    </div>
  </header>

  <main class="main-content">
    <nav class="genre-filter" id="genre-filters" aria-label="ジャンルフィルター">
      <div class="genre-filter-scroll">
        ${genreBtns}
      </div>
    </nav>

    <div class="sort-bar">
      <label for="sort-select" class="sort-label">並び替え</label>
      <select id="sort-select" aria-label="並び替え">
        <option value="likes">いいね順</option>
        <option value="updated">更新日順</option>
        <option value="title">名前順</option>
      </select>
    </div>

    <div class="recipes-grid" id="recipes-grid">
      ${recipeCards}
    </div>

    <div class="empty-state" id="empty-state" hidden>
      <div class="empty-state-icon">🔍</div>
      <p class="empty-state-text">該当するレシピが見つかりません</p>
    </div>
  </main>

  <script>
    const ALL_RECIPES = ${JSON.stringify(recipes.map(r => ({
      slug: r.slug,
      title: r.title,
      genres: r.genres,
      description: r.description,
      updated: r.updated,
      hasThumbnail: r.hasThumbnail,
      searchText: r.searchText
    })))};
    const ALL_GENRES = ${JSON.stringify(genres)};
  </script>
  <script src="js/app.js"></script>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Main Build ──────────────────────────────────────────

function build() {
  console.log('🍳 Building Recipe Book...\n');

  // Clean output
  cleanDir(DOCS_DIR);
  ensureDir(path.join(DOCS_DIR, 'recipes'));
  ensureDir(path.join(DOCS_DIR, 'css'));
  ensureDir(path.join(DOCS_DIR, 'js'));
  ensureDir(path.join(DOCS_DIR, 'img'));

  // Find recipe files
  const mdFiles = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.md'));
  if (mdFiles.length === 0) {
    console.log('⚠️  No recipe files found in recipes/');
    return;
  }
  console.log(`📄 Found ${mdFiles.length} recipe(s)\n`);

  const allRecipes = [];
  const genreSet = new Set();

  for (const file of mdFiles) {
    const slug = path.basename(file, '.md');
    console.log(`  Processing: ${file}`);

    const raw = fs.readFileSync(path.join(RECIPES_DIR, file), 'utf-8');
    const normalized = raw.replace(/\r\n/g, '\n');
    const { data: frontmatter, content: mdBody } = matter(normalized);

    // Validate required fields
    const required = ['title', 'genre', 'description', 'servings', 'updated'];
    for (const field of required) {
      if (!frontmatter[field]) {
        console.warn(`  ⚠️  Missing required field "${field}" in ${file}, skipping.`);
        continue;
      }
    }

    // Parse content
    const ingredients = parseIngredients(mdBody);
    const steps = parseSteps(mdBody, slug);

    // Check images
    const completeImageName = imageExists(slug, '_complete');
    const thumbnailName = imageExists(slug, '_thumb');

    // Parse genres
    const genres = frontmatter.genre
      ? frontmatter.genre.split(',').map(g => g.trim()).filter(Boolean)
      : [];

    const recipe = {
      slug,
      title: frontmatter.title,
      genres,
      description: frontmatter.description,
      servings: frontmatter.servings,
      updated: String(frontmatter.updated),
      ingredients,
      steps,
      hasCompleteImage: !!completeImageName,
      completeImageName,
      hasThumbnail: !!thumbnailName,
      thumbnailName,
      searchText: [
        frontmatter.title,
        ...genres,
        frontmatter.description,
        ...ingredients.map(ing => ing.name)
      ].join(' ')
    };

    allRecipes.push(recipe);
    genres.forEach(g => genreSet.add(g));

    // Generate recipe page
    const html = generateRecipeHtml(recipe);
    fs.writeFileSync(path.join(DOCS_DIR, 'recipes', `${slug}.html`), html, 'utf-8');
    console.log(`  ✅ Generated: recipes/${slug}.html`);
  }

  // Sort genres alphabetically
  const allGenres = [...genreSet].sort();

  // Generate index page
  const indexHtml = generateIndexHtml(allRecipes, allGenres);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log(`\n✅ Generated: index.html (${allRecipes.length} recipes, ${allGenres.length} genres)`);

  // Copy CSS
  const cssSource = path.join(SRC_DIR, 'css', 'style.css');
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, path.join(DOCS_DIR, 'css', 'style.css'));
    console.log('✅ Copied: css/style.css');
  }

  // Copy JS
  const jsSource = path.join(SRC_DIR, 'js', 'app.js');
  if (fs.existsSync(jsSource)) {
    fs.copyFileSync(jsSource, path.join(DOCS_DIR, 'js', 'app.js'));
    console.log('✅ Copied: js/app.js');
  }

  // Copy images
  if (fs.existsSync(IMG_DIR)) {
    const imgFiles = fs.readdirSync(IMG_DIR);
    for (const img of imgFiles) {
      const src = path.join(IMG_DIR, img);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(DOCS_DIR, 'img', img));
      }
    }
    console.log(`✅ Copied: ${imgFiles.length} image(s)`);
  }

  console.log('\n🎉 Build complete!\n');
}

build();
