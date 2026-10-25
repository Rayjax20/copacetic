const SUPABASE_URL = 'https://agpztpuugtifmnrnrhgx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFncHp0cHV1Z3RpZm1ucm5yaGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTg0MzMsImV4cCI6MjEwODMzNDQzM30.jFZWhHc2bT7PnPRhtv6GpSZdZz-yvTwmAckgF8vf-og';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

const STATUS = {
  pending:   'gold',
  confirmed: 'green',
  done:      'muted',
  no_show:   'red',
};

(async function init() {
  try {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw error;
    if (session) {
      await enterDashboard(session.user.id);
    } else {
      loginScreen.style.display = 'flex';
    }
  } catch (error) {
    console.error('Could not check staff session:', error);
    loginScreen.style.display = 'flex';
    loginError.textContent = 'Unable to check your session. Please refresh and try again.';
  }
})();

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = 'Wrong email or password.';
    return;
  }
  await enterDashboard(data.user.id);
});

async function enterDashboard(userId) {
  const { data: profile, error } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Could not verify staff access:', error);
    loginError.textContent = 'Could not verify staff access. Check the profiles table and its access policies.';
    return;
  }

  if (!profile || (profile.role !== 'admin' && profile.role !== 'barber')) {
    await sb.auth.signOut();
    loginError.textContent = 'This account is not staff.';
    loginScreen.style.display = 'flex';
    return;
  }

  loginScreen.style.display = 'none';
  dashboard.hidden = false;
  await loadDashboard();
}

async function loadDashboard() {
  const today = new Date().toISOString().split('T')[0];

  const { data: todays } = await sb
    .from('bookings')
    .select('*')
    .eq('date', today)
    .order('time');
  renderDay(todays || []);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    week.push(d.toISOString().split('T')[0]);
  }
  const { data: weekBookings } = await sb
    .from('bookings')
    .select('*')
    .in('date', week)
    .order('date');
  renderWeek(weekBookings || []);

  const { data: services } = await sb
    .from('services')
    .select('*')
    .order('price');
  renderServices(services || []);

  renderStats(todays || []);

  // Load today's blackouts by default
  loadBlackouts(today);
}

function renderDay(bookings) {
  const container = document.getElementById('daySchedule');
  container.innerHTML = '';

  if (!bookings.length) {
    container.textContent = 'No appointments booked for today.';
    return;
  }

  bookings.forEach((match) => {
    const slot = document.createElement('div');
    slot.className = `time-slot has-booking ${STATUS[match.status] || 'gold'}`;

    const label = document.createElement('span');
    label.className = 'slot-time';
    label.textContent = formatTime(match.time);
    slot.appendChild(label);

    const card = document.createElement('div');
    card.className = 'booking-card';
    card.innerHTML = `<strong>${escapeHtml(match.name)}</strong><span>${escapeHtml(match.service)}</span>`;
    slot.appendChild(card);

    const actions = document.createElement('div');
    actions.className = 'booking-actions';
    if (match.status !== 'confirmed') {
      actions.appendChild(actionBtn('Confirm', 'confirmed', match.id));
    }
    if (match.status !== 'done') {
      actions.appendChild(actionBtn('Done', 'done', match.id));
    }
    if (match.status !== 'no_show') {
      actions.appendChild(actionBtn('No-Show', 'no_show', match.id));
    }
    slot.appendChild(actions);

    container.appendChild(slot);
  });
}

function actionBtn(text, status, id) {
  const btn = document.createElement('button');
  btn.className = 'act-btn';
  btn.textContent = text;
  btn.addEventListener('click', async () => {
    const { error } = await sb
      .from('bookings')
      .update({ status })
      .eq('id', id);
    if (error) {
      alert('Could not update booking.');
      console.error(error);
    } else {
      await loadDashboard();
    }
  });
  return btn;
}

function renderWeek(bookings) {
  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';

  const byDate = {};
  bookings.forEach((b) => {
    byDate[b.date] = byDate[b.date] || [];
    byDate[b.date].push(b);
  });

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];

    const card = document.createElement('div');
    card.className = 'week-day';
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = d.getDate();
    const count = (byDate[iso] || []).length;

    card.innerHTML = `<strong>${dayName}</strong><span>${dayNum}</span><em>${count} booking${count === 1 ? '' : 's'}</em>`;
    strip.appendChild(card);
  }
}

function renderServices(services) {
  const list = document.getElementById('serviceList');
  list.innerHTML = '';
  services.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'service-item';
    item.innerHTML = `<span>${escapeHtml(s.name)}</span><strong>$${s.price}</strong>`;
    list.appendChild(item);
  });
}

function renderStats(todays) {
  const pending = todays.filter((b) => b.status === 'pending').length;
  const confirmed = todays.filter((b) => b.status === 'confirmed').length;
  document.getElementById('statToday').textContent = todays.length;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statConfirmed').textContent = confirmed;
}

// ============================================================
//  BLACKOUT WINDOWS — block any time range on a given date
// ============================================================

// Load + render blackouts for a date
async function loadBlackouts(date) {
  const { data, error } = await sb
    .from('blackouts')
    .select('*')
    .eq('date', date)
    .order('start_time');

  const list = document.getElementById('blackoutList');
  if (!list) return;
  list.innerHTML = '';

  if (error) {
    console.error('Could not load blackouts:', error);
    list.innerHTML = '<em>Could not load blackouts.</em>';
    return;
  }

  if (!data.length) {
    list.innerHTML = '<em>No blackouts for this date.</em>';
    return;
  }

  data.forEach((b) => {
    const item = document.createElement('div');
    item.className = 'blackout-item';

    const info = document.createElement('span');
    info.textContent = `${formatTime(b.start_time)} – ${formatTime(b.end_time)}${b.reason ? ' · ' + b.reason : ''}`;
    item.appendChild(info);

    const del = document.createElement('button');
    del.className = 'act-btn';
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      const { error: delErr } = await sb
        .from('blackouts')
        .delete()
        .eq('id', b.id);
      if (delErr) {
        alert('Could not remove blackout.');
        console.error(delErr);
      } else {
        loadBlackouts(date);
      }
    });
    item.appendChild(del);

    list.appendChild(item);
  });
}

// Save a new blackout
async function saveBlackout(e) {
  e.preventDefault();
  const date = document.getElementById('blackoutDate').value;
  const start = document.getElementById('blackoutStart').value.trim();
  const end = document.getElementById('blackoutEnd').value.trim();
  const reason = document.getElementById('blackoutReason').value.trim();

  if (!date || !start || !end) {
    alert('Pick a date and both times.');
    return;
  }

  const { error } = await sb
    .from('blackouts')
    .insert({ date, start_time: start, end_time: end, reason });

  if (error) {
    alert('Could not save blackout.');
    console.error(error);
  } else {
    alert('Blackout saved!');
    e.target.reset();
    loadBlackouts(date);
  }
}

// Wire up the blackout form if it exists
const blackoutForm = document.getElementById('blackoutForm');
if (blackoutForm) {
  blackoutForm.addEventListener('submit', saveBlackout);
  const dateInput = document.getElementById('blackoutDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
    dateInput.addEventListener('change', (e) => loadBlackouts(e.target.value));
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

function formatTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hr = hours % 12 === 0 ? 12 : hours % 12;
  return `${hr}:${String(minutes).padStart(2, '0')} ${ampm}`;
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
