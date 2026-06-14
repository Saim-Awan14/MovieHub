/**
 * MovieHub – app.js  (v2 – fixed)
 * User Panel: fetch, render, debounced search, genre filter,
 *             recommendation form with full inline validation.
 *
 * Fixes applied:
 *  • Removed dead heroCta const (element is replaced by populateHero)
 *  • Removed dead ratingToStars helper
 *  • Hero background update now uses a reliable SVG data-URI fallback
 *  • onerror on poster images uses a stable inline SVG fallback (no external URL)
 *  • showError() no longer persists after a successful retry
 *  • renderMovies hides spinner AND emptyState correctly before re-render
 */

'use strict';

const API_URL = 'http://localhost:3000/movies';

// Fully percent-encoded SVG fallback – no raw single or double quotes inside,
// so it is safe to embed in both onerror="..." and onerror='...' attributes.
const FALLBACK_POSTER = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22200%22%20height%3D%22300%22%20viewBox%3D%220%200%20200%20300%22%3E%3Crect%20width%3D%22200%22%20height%3D%22300%22%20fill%3D%22%231c1c28%22%2F%3E%3Ctext%20x%3D%22100%22%20y%3D%22145%22%20text-anchor%3D%22middle%22%20fill%3D%22%238888a0%22%20font-size%3D%2216%22%20font-family%3D%22sans-serif%22%3ENo%20Poster%3C%2Ftext%3E%3C%2Fsvg%3E';

// ── DOM References ───────────────────────────────────────────────────────────
const moviesGrid     = document.getElementById('moviesGrid');
const loadingSpinner = document.getElementById('loadingSpinner');
const errorAlert     = document.getElementById('errorAlert');
const emptyState     = document.getElementById('emptyState');
const searchInput    = document.getElementById('searchInput');
const genreFilter    = document.getElementById('genreFilter');
const movieCount     = document.getElementById('movieCount');
const recommendForm  = document.getElementById('recommendForm');
const submitBtn      = document.getElementById('submitBtn');
const formSuccess    = document.getElementById('formSuccess');

// Recommendation form fields
const rfTitle  = document.getElementById('rf-title');
const rfGenre  = document.getElementById('rf-genre');
const rfYear   = document.getElementById('rf-year');
const rfRating = document.getElementById('rf-rating');
const rfReview = document.getElementById('rf-review');
const rfPoster = document.getElementById('rf-poster');

// ── Application State ────────────────────────────────────────────────────────
let allMovies   = [];
let searchTimer = null;

// ── Theme ────────────────────────────────────────────────────────────────────
(function initTheme() {
  applyTheme(localStorage.getItem('mh-theme') || 'dark');
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('mh-theme', next);
});

/**
 * applyTheme – toggle between dark and light mode
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
}

// ── Data Fetching ────────────────────────────────────────────────────────────

/**
 * fetchMovies – GET /movies, then render hero + grid
 */
async function fetchMovies() {
  showLoading(true);
  hideError();

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    allMovies = await response.json();
    populateHero(allMovies);
    renderMovies(allMovies);
  } catch (err) {
    showError(`Cannot reach JSON Server. Make sure it is running on port 3000.`);
  } finally {
    showLoading(false);
  }
}

// ── Hero Section ─────────────────────────────────────────────────────────────

/**
 * populateHero – fill the hero section with the highest-rated movie
 * @param {Array} movies
 */
function populateHero(movies) {
  if (!movies || movies.length === 0) return;

  const top    = [...movies].sort((a, b) => b.rating - a.rating)[0];
  const heroEl = document.getElementById('heroContent');
  if (!heroEl) return;

  heroEl.innerHTML = `
    <div class="mh-hero-badge">
      <i class="bi bi-trophy-fill"></i> Top Rated
    </div>
    <h1 class="mh-hero-title">${escapeHtml(top.title)}</h1>
    <div class="mh-hero-meta">
      <span class="badge bg-danger">${escapeHtml(top.genre)}</span>
      <span class="text-warning fw-bold">
        <i class="bi bi-star-fill me-1"></i>${Number(top.rating).toFixed(1)}
      </span>
      <span class="text-white-50">${top.year}</span>
    </div>
    <p class="mh-hero-desc">${escapeHtml(top.review)}</p>
    <button class="btn btn-danger btn-lg mh-cta-btn" id="heroCtaBtn">
      <i class="bi bi-play-fill me-2"></i>Browse All Movies
    </button>`;

  // Bind CTA button (recreated with each hero update)
  document.getElementById('heroCtaBtn').addEventListener('click', () => {
    document.getElementById('movies-section').scrollIntoView({ behavior: 'smooth' });
  });

  // Update hero background image; keep gradient overlay via CSS
  const heroSection = document.getElementById('heroSection');
  if (heroSection && top.poster) {
    heroSection.style.backgroundImage = `url('${top.poster}')`;
    heroSection.style.backgroundSize  = 'cover';
    heroSection.style.backgroundPosition = 'center top';
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * renderMovies – apply search + genre filter, then build cards
 * @param {Array} movies – full dataset
 */
function renderMovies(movies) {
  const query = searchInput.value.trim().toLowerCase();
  const genre = genreFilter.value;

  const filtered = movies.filter(movie => {
    const titleMatch = movie.title.toLowerCase().includes(query);
    const genreMatch = genre === '' || movie.genre === genre;
    return titleMatch && genreMatch;
  });

  // Update count badge
  movieCount.textContent = `${filtered.length} movie${filtered.length !== 1 ? 's' : ''}`;

  // Hide empty state first (will re-show below if needed)
  emptyState.classList.add('d-none');

  if (filtered.length === 0) {
    moviesGrid.innerHTML = '';
    emptyState.classList.remove('d-none');
    return;
  }

  moviesGrid.innerHTML = filtered.map((movie, index) => buildMovieCard(movie, index)).join('');
}

/**
 * buildMovieCard – returns Bootstrap card HTML string
 * @param {Object} movie
 * @param {number} index – stagger animation delay
 * @returns {string}
 */
function buildMovieCard(movie, index) {
  const delayMs    = Math.min(index * 45, 350);
  const posterSrc  = movie.poster ? escapeAttr(movie.poster) : FALLBACK_POSTER;

  return `
    <div class="col">
      <div class="mh-card mh-card-anim" style="animation-delay:${delayMs}ms">

        <div class="mh-card-img-wrap">
          <img
            src="${posterSrc}"
            alt="${escapeAttr(movie.title)} poster"
            class="mh-card-img"
            loading="lazy"
            onerror="this.onerror=null;this.src='${FALLBACK_POSTER}'"
          />
          <span class="mh-card-rating">
            <i class="bi bi-star-fill"></i>${Number(movie.rating).toFixed(1)}
          </span>
          <div class="mh-card-genre">
            <span class="badge bg-danger">${escapeHtml(movie.genre)}</span>
          </div>
        </div>

        <div class="card-body">
          <h5 class="mh-card-title" title="${escapeAttr(movie.title)}">
            ${escapeHtml(movie.title)}
          </h5>
          <p class="mh-card-year">
            <i class="bi bi-calendar3 me-1"></i>${movie.year}
          </p>
          <p class="mh-card-review">${escapeHtml(movie.review)}</p>
        </div>

      </div>
    </div>`;
}

// ── UI State Helpers ─────────────────────────────────────────────────────────

/** Show or hide the loading spinner */
function showLoading(visible) {
  loadingSpinner.classList.toggle('d-none', !visible);
}

/** Show the error alert with an optional custom message */
function showError(msg) {
  if (msg) {
    const msgEl = errorAlert.querySelector('.mh-error-msg');
    if (msgEl) msgEl.textContent = msg;
  }
  errorAlert.classList.remove('d-none');
}

/** Hide the error alert */
function hideError() {
  errorAlert.classList.add('d-none');
}

// ── Search & Filter ──────────────────────────────────────────────────────────

// Debounced search: wait 300 ms after last keystroke
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderMovies(allMovies), 300);
});

// Instant genre filter on change
genreFilter.addEventListener('change', () => renderMovies(allMovies));

// ── Recommendation Form ──────────────────────────────────────────────────────

recommendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateRecommendForm()) return;

  const newMovie = {
    title:  rfTitle.value.trim(),
    genre:  rfGenre.value,
    year:   parseInt(rfYear.value, 10),
    rating: parseFloat(Number(rfRating.value).toFixed(1)),
    review: rfReview.value.trim(),
    poster: rfPoster.value.trim()
  };

  setSubmitLoading(true);
  try {
    const response = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(newMovie)
    });
    if (!response.ok) throw new Error(`POST failed: ${response.status}`);

    showFormSuccess();
    resetRecommendForm();
    await fetchMovies();   // re-fetch to get server-assigned id
  } catch (err) {
    setInvalid(rfPoster, 'err-poster', 'Submission failed. Ensure JSON Server is running on port 3000.');
  } finally {
    setSubmitLoading(false);
  }
});

// ── Form Validation ──────────────────────────────────────────────────────────

/**
 * validateRecommendForm – checks every field, marks valid/invalid inline
 * @returns {boolean} true if all fields pass
 */
function validateRecommendForm() {
  let isValid   = true;
  const curYear = new Date().getFullYear();

  // Title – required, non-empty
  if (!rfTitle.value.trim()) {
    setInvalid(rfTitle, 'err-title', 'Movie title is required.');
    isValid = false;
  } else {
    setValid(rfTitle, 'err-title');
  }

  // Genre – must select an option
  if (!rfGenre.value) {
    setInvalid(rfGenre, 'err-genre', 'Please select a genre.');
    isValid = false;
  } else {
    setValid(rfGenre, 'err-genre');
  }

  // Year – integer between 1888 and current year + 2
  const year = parseInt(rfYear.value, 10);
  if (!rfYear.value.trim() || isNaN(year) || year < 1888 || year > curYear + 2) {
    setInvalid(rfYear, 'err-year', `Enter a valid year (1888 – ${curYear + 2}).`);
    isValid = false;
  } else {
    setValid(rfYear, 'err-year');
  }

  // Rating – number between 1 and 10
  const rating = parseFloat(rfRating.value);
  if (!rfRating.value.trim() || isNaN(rating) || rating < 1 || rating > 10) {
    setInvalid(rfRating, 'err-rating', 'Rating must be a number between 1 and 10.');
    isValid = false;
  } else {
    setValid(rfRating, 'err-rating');
  }

  // Review – 10 to 300 characters
  const review = rfReview.value.trim();
  if (review.length < 10 || review.length > 300) {
    setInvalid(rfReview, 'err-review', 'Review must be between 10 and 300 characters.');
    isValid = false;
  } else {
    setValid(rfReview, 'err-review');
  }

  // Poster URL – valid http/https URL
  if (!isValidUrl(rfPoster.value.trim())) {
    setInvalid(rfPoster, 'err-poster', 'Enter a valid image URL (https://…).');
    isValid = false;
  } else {
    setValid(rfPoster, 'err-poster');
  }

  return isValid;
}

// Real-time blur validation ──────────────────────────────────────────────────
rfTitle.addEventListener('blur', () => {
  rfTitle.value.trim()
    ? setValid(rfTitle, 'err-title')
    : setInvalid(rfTitle, 'err-title', 'Movie title is required.');
});

rfGenre.addEventListener('blur', () => {
  rfGenre.value
    ? setValid(rfGenre, 'err-genre')
    : setInvalid(rfGenre, 'err-genre', 'Please select a genre.');
});

rfYear.addEventListener('blur', () => {
  const y   = parseInt(rfYear.value, 10);
  const cur = new Date().getFullYear();
  (!rfYear.value.trim() || isNaN(y) || y < 1888 || y > cur + 2)
    ? setInvalid(rfYear, 'err-year', `Enter a valid year (1888 – ${cur + 2}).`)
    : setValid(rfYear, 'err-year');
});

rfRating.addEventListener('blur', () => {
  const r = parseFloat(rfRating.value);
  (!rfRating.value.trim() || isNaN(r) || r < 1 || r > 10)
    ? setInvalid(rfRating, 'err-rating', 'Rating must be between 1 and 10.')
    : setValid(rfRating, 'err-rating');
});

rfReview.addEventListener('blur', () => {
  const v = rfReview.value.trim();
  (v.length < 10 || v.length > 300)
    ? setInvalid(rfReview, 'err-review', 'Review must be 10 – 300 characters.')
    : setValid(rfReview, 'err-review');
});

rfPoster.addEventListener('blur', () => {
  isValidUrl(rfPoster.value.trim())
    ? setValid(rfPoster, 'err-poster')
    : setInvalid(rfPoster, 'err-poster', 'Enter a valid image URL (https://…).');
});

// ── Form Utility Helpers ─────────────────────────────────────────────────────

function setInvalid(el, errId, msg) {
  el.classList.add('is-invalid');
  el.classList.remove('is-valid');
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = msg;
}

function setValid(el, errId) {
  el.classList.remove('is-invalid');
  el.classList.add('is-valid');
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = '';
}

function setSubmitLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.innerHTML = loading
    ? '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Submitting…'
    : '<i class="bi bi-send-fill me-2"></i>Submit Recommendation';
}

function showFormSuccess() {
  formSuccess.classList.remove('d-none');
  setTimeout(() => formSuccess.classList.add('d-none'), 4500);
}

function resetRecommendForm() {
  recommendForm.reset();
  [rfTitle, rfGenre, rfYear, rfRating, rfReview, rfPoster].forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });
  ['err-title', 'err-genre', 'err-year', 'err-rating', 'err-review', 'err-poster'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

// ── Shared Utilities ─────────────────────────────────────────────────────────

/**
 * escapeHtml – sanitise text content before inserting via innerHTML
 * Prevents XSS from user-supplied data
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * escapeAttr – safe value for HTML attribute strings
 */
function escapeAttr(str) {
  return escapeHtml(str);
}

/**
 * isValidUrl – returns true for http or https URLs
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Bind the static hero CTA button that shows before data loads
const staticHeroCta = document.getElementById('heroCta');
if (staticHeroCta) {
  staticHeroCta.addEventListener('click', () => {
    document.getElementById('movies-section').scrollIntoView({ behavior: 'smooth' });
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
fetchMovies();