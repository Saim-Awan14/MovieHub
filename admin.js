/**
 * MovieHub – admin.js  (v2 – fixed)
 * Admin Panel: dashboard stats, add (POST), edit (PUT), delete (DELETE)
 *
 * Fixes applied:
 *  • fw-600 → fw-semibold in buildTableRow (Bootstrap class fix)
 *  • stat-top now uses textContent, not escapeHtml (no double-encoding)
 *  • showError() in delete catch auto-hides after 5 s
 *  • resetAdminForm also clears all validation states on Cancel
 *  • setSubmitLoading respects edit vs add mode for button label
 *  • Poster fallback uses inline SVG data-URI (no external URL dependency)
 *  • dashboardContent stays visible after delete / edit refresh
 *  • deleteTargetId reset happens AFTER successful fetch to avoid race
 */

'use strict';

const API_URL = 'http://localhost:3000/movies';

// Fully percent-encoded SVG fallback – no raw single or double quotes inside,
// so it is safe to embed in both onerror="..." and onerror='...' attributes.
const FALLBACK_POSTER = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2240%22%20height%3D%2256%22%20viewBox%3D%220%200%2040%2056%22%3E%3Crect%20width%3D%2240%22%20height%3D%2256%22%20fill%3D%22%231c1c28%22%2F%3E%3Ctext%20x%3D%2220%22%20y%3D%2234%22%20text-anchor%3D%22middle%22%20fill%3D%22%238888a0%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%3ENo%20Image%3C%2Ftext%3E%3C%2Fsvg%3E';

// ── DOM References ───────────────────────────────────────────────────────────
const loadingSpinner   = document.getElementById('loadingSpinner');
const errorAlert       = document.getElementById('errorAlert');
const dashboardContent = document.getElementById('dashboardContent');
const moviesTableBody  = document.getElementById('moviesTableBody');
const tableEmpty       = document.getElementById('tableEmpty');
const tableCount       = document.getElementById('tableCount');
const movieForm        = document.getElementById('movieForm');
const submitBtn        = document.getElementById('submitBtn');
const submitLabel      = document.getElementById('submitLabel');
const cancelEditBtn    = document.getElementById('cancelEditBtn');
const formSuccess      = document.getElementById('formSuccess');
const formSuccessMsg   = document.getElementById('formSuccessMsg');
const formTitle        = document.getElementById('formTitle');
const formSubtitle     = document.getElementById('formSubtitle');
const editIdInput      = document.getElementById('editId');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Admin form fields
const fTitle  = document.getElementById('f-title');
const fGenre  = document.getElementById('f-genre');
const fYear   = document.getElementById('f-year');
const fRating = document.getElementById('f-rating');
const fReview = document.getElementById('f-review');
const fPoster = document.getElementById('f-poster');

// ── State ────────────────────────────────────────────────────────────────────
let allMovies      = [];
let deleteTargetId = null;

// Bootstrap modal instance – created lazily on first use so that a slow
// CDN cannot crash the entire script before Bootstrap is available.
let _deleteModal = null;
function getDeleteModal() {
  if (!_deleteModal) {
    _deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
  }
  return _deleteModal;
}

// ── Theme ────────────────────────────────────────────────────────────────────
(function initTheme() {
  applyTheme(localStorage.getItem('mh-theme') || 'dark');
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('mh-theme', next);
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

/**
 * fetchMovies – GET /movies, then refresh stats and table
 * Called on initial load and after every CUD operation.
 */
async function fetchMovies() {
  showLoading(true);
  hideError();

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    allMovies = await response.json();
    renderStats(allMovies);
    renderTable(allMovies);
    dashboardContent.classList.remove('d-none');
  } catch (err) {
    showError('Cannot reach JSON Server. Make sure it is running: npx json-server --watch db.json');
  } finally {
    showLoading(false);
  }
}

// ── Statistics ────────────────────────────────────────────────────────────────

/**
 * renderStats – compute and display the 4 dashboard stat cards
 * @param {Array} movies
 */
function renderStats(movies) {
  // Total count
  document.getElementById('stat-total').textContent = movies.length;

  // Average rating (1 decimal place)
  const avg = movies.length
    ? (movies.reduce((sum, m) => sum + Number(m.rating), 0) / movies.length).toFixed(1)
    : '—';
  document.getElementById('stat-avg').textContent = avg;

  // Unique genre count
  const uniqueGenres = new Set(movies.map(m => m.genre)).size;
  document.getElementById('stat-genres').textContent = uniqueGenres || '—';

  // Highest rated movie – FIX: use textContent, not escapeHtml, to avoid &amp; appearing
  const topMovie = movies.length
    ? [...movies].sort((a, b) => b.rating - a.rating)[0]
    : null;

  const statTopEl = document.getElementById('stat-top');
  if (topMovie) {
    statTopEl.textContent = `${topMovie.title} (${Number(topMovie.rating).toFixed(1)})`;
  } else {
    statTopEl.textContent = '—';
  }
}

// ── Table Rendering ───────────────────────────────────────────────────────────

/**
 * renderTable – build the management table from the movies array
 * @param {Array} movies
 */
function renderTable(movies) {
  tableCount.textContent = `${movies.length} movie${movies.length !== 1 ? 's' : ''}`;

  if (movies.length === 0) {
    moviesTableBody.innerHTML = '';
    tableEmpty.classList.remove('d-none');
    return;
  }

  tableEmpty.classList.add('d-none');
  moviesTableBody.innerHTML = movies.map(buildTableRow).join('');
  attachTableEvents();
}

/**
 * buildTableRow – HTML for a single table row
 * @param {Object} movie
 * @returns {string}
 */
function buildTableRow(movie) {
  const safePoster = movie.poster ? escapeAttr(movie.poster) : FALLBACK_POSTER;

  // FIX: use fw-semibold (valid Bootstrap 5 class), not fw-600
  return `
    <tr data-id="${movie.id}">
      <td>
        <img
          src="${safePoster}"
          alt="${escapeAttr(movie.title)}"
          class="mh-table-poster"
          loading="lazy"
          onerror="this.onerror=null;this.src='${FALLBACK_POSTER}'"
        />
      </td>
      <td><span class="fw-semibold">${escapeHtml(movie.title)}</span></td>
      <td><span class="badge bg-danger">${escapeHtml(movie.genre)}</span></td>
      <td class="text-nowrap">${movie.year}</td>
      <td class="text-nowrap">
        <span class="text-warning fw-semibold">
          <i class="bi bi-star-fill me-1"></i>${Number(movie.rating).toFixed(1)}
        </span>
      </td>
      <td class="text-end text-nowrap">
        <button
          class="btn btn-sm btn-outline-primary me-1 btn-edit"
          data-id="${movie.id}"
          title="Edit movie"
          aria-label="Edit ${escapeAttr(movie.title)}"
        >
          <i class="bi bi-pencil-fill"></i>
        </button>
        <button
          class="btn btn-sm btn-outline-danger btn-delete"
          data-id="${movie.id}"
          data-title="${escapeAttr(movie.title)}"
          title="Delete movie"
          aria-label="Delete ${escapeAttr(movie.title)}"
        >
          <i class="bi bi-trash3-fill"></i>
        </button>
      </td>
    </tr>`;
}

/**
 * attachTableEvents – re-bind edit & delete buttons after each render
 * (innerHTML wipe removes all event listeners, so we re-add them)
 */
function attachTableEvents() {
  moviesTableBody.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => loadMovieForEdit(parseInt(btn.dataset.id, 10)));
  });

  moviesTableBody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(parseInt(btn.dataset.id, 10), btn.dataset.title));
  });
}

// ── Add / Edit Form ───────────────────────────────────────────────────────────

movieForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateAdminForm()) return;

  const movieData = {
    title:  fTitle.value.trim(),
    genre:  fGenre.value,
    year:   parseInt(fYear.value, 10),
    rating: parseFloat(Number(fRating.value).toFixed(1)),
    review: fReview.value.trim(),
    poster: fPoster.value.trim()
  };

  const isEditing = editIdInput.value !== '';
  setSubmitLoading(true);

  try {
    let response;

    if (isEditing) {
      // PUT – full replacement of the resource
      response = await fetch(`${API_URL}/${editIdInput.value}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(movieData)
      });
    } else {
      // POST – create new resource
      response = await fetch(API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(movieData)
      });
    }

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);

    formSuccessMsg.textContent = isEditing
      ? `"${movieData.title}" updated successfully!`
      : `"${movieData.title}" added successfully!`;

    showFormSuccess();
    resetAdminForm();
    await fetchMovies();
  } catch (err) {
    // Show error on the review field so user sees it near the submit button
    setInvalid(fReview, 'err-review', 'Save failed – make sure JSON Server is running on port 3000.');
  } finally {
    setSubmitLoading(false);
  }
});

/**
 * loadMovieForEdit – populate form with existing movie data and switch to edit mode
 * @param {number} id
 */
function loadMovieForEdit(id) {
  const movie = allMovies.find(m => m.id === id);
  if (!movie) return;

  // Populate fields
  editIdInput.value = movie.id;
  fTitle.value      = movie.title;
  fGenre.value      = movie.genre;
  fYear.value       = movie.year;
  fRating.value     = movie.rating;
  fReview.value     = movie.review;
  fPoster.value     = movie.poster || '';

  // Switch UI to edit mode
  formTitle.innerHTML      = '<i class="bi bi-pencil-fill text-warning me-2"></i>Edit Movie';
  formSubtitle.textContent = `Editing: ${movie.title}`;
  submitLabel.textContent  = 'Save Changes';
  submitBtn.className      = 'btn btn-warning px-4';
  cancelEditBtn.classList.remove('d-none');

  // Clear any prior validation state
  [fTitle, fGenre, fYear, fRating, fReview, fPoster].forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });

  // Scroll form into view
  movieForm.closest('.mh-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

cancelEditBtn.addEventListener('click', resetAdminForm);

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * openDeleteModal – set the target and show the confirmation modal
 * @param {number} id
 * @param {string} title
 */
function openDeleteModal(id, title) {
  deleteTargetId = id;
  document.getElementById('deleteMovieName').textContent = title;
  getDeleteModal().show();
}

confirmDeleteBtn.addEventListener('click', async () => {
  if (!deleteTargetId) return;

  const idToDelete = deleteTargetId;   // capture before any async gap
  getDeleteModal().hide();

  try {
    const response = await fetch(`${API_URL}/${idToDelete}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`DELETE failed: ${response.status}`);

    deleteTargetId = null;
    await fetchMovies();   // refresh table and stats
  } catch (err) {
    deleteTargetId = null;
    showError('Delete failed – make sure JSON Server is running on port 3000.');
    // Auto-hide the error after 5 seconds
    setTimeout(hideError, 5000);
  }
});

// ── Admin Form Validation ─────────────────────────────────────────────────────

/**
 * validateAdminForm – full check, marks every field inline; no alert() calls
 * @returns {boolean}
 */
function validateAdminForm() {
  let isValid   = true;
  const curYear = new Date().getFullYear();

  if (!fTitle.value.trim()) {
    setInvalid(fTitle, 'err-title', 'Movie title is required.');
    isValid = false;
  } else {
    setValid(fTitle, 'err-title');
  }

  if (!fGenre.value) {
    setInvalid(fGenre, 'err-genre', 'Please select a genre.');
    isValid = false;
  } else {
    setValid(fGenre, 'err-genre');
  }

  const year = parseInt(fYear.value, 10);
  if (!fYear.value.trim() || isNaN(year) || year < 1888 || year > curYear + 2) {
    setInvalid(fYear, 'err-year', `Enter a valid year (1888 – ${curYear + 2}).`);
    isValid = false;
  } else {
    setValid(fYear, 'err-year');
  }

  const rating = parseFloat(fRating.value);
  if (!fRating.value.trim() || isNaN(rating) || rating < 1 || rating > 10) {
    setInvalid(fRating, 'err-rating', 'Rating must be between 1 and 10.');
    isValid = false;
  } else {
    setValid(fRating, 'err-rating');
  }

  const review = fReview.value.trim();
  if (review.length < 10 || review.length > 300) {
    setInvalid(fReview, 'err-review', 'Review must be 10 – 300 characters.');
    isValid = false;
  } else {
    setValid(fReview, 'err-review');
  }

  if (!isValidUrl(fPoster.value.trim())) {
    setInvalid(fPoster, 'err-poster', 'Enter a valid image URL (https://…).');
    isValid = false;
  } else {
    setValid(fPoster, 'err-poster');
  }

  return isValid;
}

// Real-time blur validation ──────────────────────────────────────────────────
fTitle.addEventListener('blur', () => {
  fTitle.value.trim()
    ? setValid(fTitle, 'err-title')
    : setInvalid(fTitle, 'err-title', 'Movie title is required.');
});

fGenre.addEventListener('blur', () => {
  fGenre.value
    ? setValid(fGenre, 'err-genre')
    : setInvalid(fGenre, 'err-genre', 'Please select a genre.');
});

fYear.addEventListener('blur', () => {
  const y   = parseInt(fYear.value, 10);
  const cur = new Date().getFullYear();
  (!fYear.value.trim() || isNaN(y) || y < 1888 || y > cur + 2)
    ? setInvalid(fYear, 'err-year', `Enter a valid year (1888 – ${cur + 2}).`)
    : setValid(fYear, 'err-year');
});

fRating.addEventListener('blur', () => {
  const r = parseFloat(fRating.value);
  (!fRating.value.trim() || isNaN(r) || r < 1 || r > 10)
    ? setInvalid(fRating, 'err-rating', 'Rating must be between 1 and 10.')
    : setValid(fRating, 'err-rating');
});

fReview.addEventListener('blur', () => {
  const v = fReview.value.trim();
  (v.length < 10 || v.length > 300)
    ? setInvalid(fReview, 'err-review', 'Review must be 10 – 300 characters.')
    : setValid(fReview, 'err-review');
});

fPoster.addEventListener('blur', () => {
  isValidUrl(fPoster.value.trim())
    ? setValid(fPoster, 'err-poster')
    : setInvalid(fPoster, 'err-poster', 'Enter a valid image URL (https://…).');
});

// ── Form Utility Helpers ──────────────────────────────────────────────────────

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
  const isEditing    = editIdInput.value !== '';
  submitLabel.textContent = loading
    ? 'Saving…'
    : (isEditing ? 'Save Changes' : 'Add Movie');
}

function showFormSuccess() {
  formSuccess.classList.remove('d-none');
  setTimeout(() => formSuccess.classList.add('d-none'), 4500);
}

/**
 * resetAdminForm – clear fields and revert to "Add Movie" mode
 */
function resetAdminForm() {
  movieForm.reset();
  editIdInput.value = '';

  // Clear all validation classes
  [fTitle, fGenre, fYear, fRating, fReview, fPoster].forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });
  ['err-title', 'err-genre', 'err-year', 'err-rating', 'err-review', 'err-poster'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  // Restore "Add" mode UI
  formTitle.innerHTML      = '<i class="bi bi-plus-circle-fill text-danger me-2"></i>Add New Movie';
  formSubtitle.textContent = 'Fill in the details to add a movie to the database.';
  submitLabel.textContent  = 'Add Movie';
  submitBtn.className      = 'btn btn-danger px-4';
  cancelEditBtn.classList.add('d-none');
}

// ── UI State Helpers ──────────────────────────────────────────────────────────

function showLoading(visible) {
  loadingSpinner.classList.toggle('d-none', !visible);
}

function showError(msg) {
  const msgEl = errorAlert.querySelector('.mh-error-msg');
  if (msgEl && msg) msgEl.textContent = msg;
  errorAlert.classList.remove('d-none');
}

function hideError() {
  errorAlert.classList.add('d-none');
}

// ── Shared Utilities ──────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function isValidUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
fetchMovies();