// booking.js — service-based appointment availability + Supabase insert
// ============================================================
//  🔑  PUT YOUR SUPABASE KEYS HERE
// ============================================================
const SUPABASE_URL = 'https://agpztpuugtifmnrnrhgx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFncHp0cHV1Z3RpZm1ucm5yaGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTg0MzMsImV4cCI6MjEwODMzNDQzM30.jFZWhHc2bT7PnPRhtv6GpSZdZz-yvTwmAckgF8vf-og';
// ============================================================

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Config (change these, not the logic) --------------------
const CONFIG = {
  OPEN_HOUR: 8,       // 8:00 AM
  CLOSE_HOUR: 20,     // 8:00 PM
  SLOT_INTERVAL: 15,  // 15-min steps
  DAYS_OPEN: [0,1,2,3,4,5,6], // every day
  BUFFER_MIN: 10,     // [FOOTPRINT] solo barber pad — keeps cuts from running into each other
};

// ---- Grab form elements -------------------------------------
const form = document.getElementById('bookingForm');
const nameEl = document.getElementById('name');
const mainServiceInputs = [...form.querySelectorAll('input[name="mainService"]')];
const addOnInputs = [...form.querySelectorAll('input[name="addOn"]')];
const dateEl = document.getElementById('date');
const timeEl = document.getElementById('time');
const notesEl = document.getElementById('notes');
const availabilityMessage = document.getElementById('availabilityMessage');
const serviceSummary = document.getElementById('serviceSummary');
const addOnOptions = form.querySelector('.add-on-options');

// ---- Service durations — pulled from the services table, not hardcoded
let SERVICES = {};
async function loadServices() {
  const { data, error } = await supabaseClient
    .from('services')
    .select('name, price, duration_min');
  if (error) {
    console.error('Could not load services:', error);
    return;
  }
  SERVICES = Object.fromEntries(
    data.map((s) => [`${s.name} — $${s.price}`, s.duration_min])
  );
  // Longest cut = max duration — this drives the whole schedule check
  CONFIG.LONGEST_CUT = Math.max(...data.map((s) => s.duration_min));
  updateServiceSummary();
}

// ---- Restrict date picker: no past dates --------------------
const today = new Date();
dateEl.min = today.toISOString().split('T')[0];

// ---- Reset available times until a service and date are selected
function resetTimeOptions(message) {
  timeEl.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = message;
  timeEl.appendChild(opt);
  timeEl.disabled = true;
}

function selectedServices() {
  const mainService = mainServiceInputs.find((input) => input.checked);
  if (!mainService) return [];
  if (mainService.value === 'The Full Copacetic — $60') return [mainService];
  return [mainService, ...addOnInputs.filter((input) => input.checked)];
}

function updateServiceSummary() {
  const services = selectedServices();
  if (!services.length) {
    serviceSummary.textContent = 'Choose a main service to see your appointment length and total.';
    return;
  }
  if (services[0].value === 'The Full Copacetic — $60') {
    serviceSummary.textContent = 'The Full Copacetic includes all services · 60 minutes · $60';
    return;
  }
  const duration = services.reduce((t, s) => t + Number(s.dataset.duration), 0);
  const price = services.reduce((t, s) => t + Number(s.dataset.price), 0);
  serviceSummary.textContent = `Estimated appointment: ${duration} minutes · $${price}`;
}

function getServiceDuration(service) {
  return service.split(' + ').reduce((total, item) => total + (SERVICES[item] || 0), 0) || 45;
}

// ---- Blackout windows from the admin page --------------------
let blackouts = [];
async function loadBlackouts(date) {
  const { data, error } = await supabaseClient
    .from('blackouts')
    .select('start_time, end_time')
    .eq('date', date);
  if (error) {
    console.error('Could not load blackouts:', error);
    blackouts = [];
    return;
  }
  blackouts = (data || []).map((b) => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time),
  }));
}

function overlapsBlackout(start, end) {
  return blackouts.some((b) => start < b.end && b.start < end);
}

// ---- Offer start times that fit the selected service ----------
let availabilityRequest = 0;
async function updateAvailableTimes() {
  const request = ++availabilityRequest;
  const services = selectedServices();
  const duration = services.reduce((t, s) => t + Number(s.dataset.duration), 0);
  timeEl.value = '';
  if (!dateEl.value || !services.length) {
    resetTimeOptions('Choose a service and date first');
    availabilityMessage.textContent = 'Choose a service and date to see available appointment times.';
    return;
  }

  resetTimeOptions('click the arrow to choose a time…');
  availabilityMessage.textContent = 'Checking availability…';

  // Load bookings + blackouts in parallel
  const [bookingsRes, blackoutRes] = await Promise.all([
    supabaseClient.from('bookings').select('time, service, status').eq('date', dateEl.value),
    supabaseClient.from('blackouts').select('start_time, end_time').eq('date', dateEl.value),
  ]);
  if (request !== availabilityRequest) return;

  if (bookingsRes.error || blackoutRes.error) {
    console.error('Could not load availability:', bookingsRes.error || blackoutRes.error);
    resetTimeOptions('Could not load times');
    availabilityMessage.textContent = 'Availability could not be loaded. Please try again.';
    return;
  }

  const bookings = (bookingsRes.data || [])
    .filter((b) => b.status !== 'done' && b.status !== 'no_show')
    .map((b) => ({
      start: timeToMinutes(b.time),
      // [FOOTPRINT] each booking reserves its full block, not just its start
      end: timeToMinutes(b.time) + getServiceDuration(b.service) + CONFIG.BUFFER_MIN,
    }))
    .filter((b) => b.start !== null);

  blackouts = (blackoutRes.data || []).map((b) => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time),
  }));

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose an available time';
  timeEl.appendChild(placeholder);

  let availableCount = 0;
  const open = CONFIG.OPEN_HOUR * 60;
  const close = CONFIG.CLOSE_HOUR * 60;

  // [FOOTPRINT] the candidate's whole block must be clear of bookings AND blackouts
  const footprint = duration + CONFIG.BUFFER_MIN;
  for (let start = open; start + footprint <= close; start += CONFIG.SLOT_INTERVAL) {
    const end = start + footprint;
    const overlapsBooking = bookings.some((b) => start < b.end && b.start < end);
    if (overlapsBooking || overlapsBlackout(start, end)) continue;

    const option = document.createElement('option');
    option.value = minutesToTime(start);
    option.textContent = formatTime(start);
    timeEl.appendChild(option);
    availableCount++;
  }

  timeEl.disabled = availableCount === 0;
  availabilityMessage.textContent = availableCount
    ? `${availableCount} available start times for your selected services.`
    : 'No times are available for this service on that date.';
  if (!availableCount) resetTimeOptions('No available times');
}

dateEl.addEventListener('change', updateAvailableTimes);
form.addEventListener('change', (event) => {
  if (!event.target.matches('input[name="mainService"], input[name="addOn"]')) return;
  if (event.target.name === 'mainService') {
    const fullCopacetic = event.target.value === 'The Full Copacetic — $60' && event.target.checked;
    addOnOptions.disabled = fullCopacetic;
    addOnInputs.forEach((input) => { if (fullCopacetic) input.checked = false; });
  }
  updateServiceSummary();
  updateAvailableTimes();
});

// ---- Submit: insert into Supabase ---------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!timeEl.value) return;

  const booking = {
    name: nameEl.value.trim(),
    service: selectedServices().map((s) => s.value).join(' + '),
    date: dateEl.value,
    time: timeEl.value,
    notes: notesEl.value.trim(),
    status: 'pending',
  };

  const { error } = await supabaseClient.from('bookings').insert(booking);
  if (error) {
    alert('Something went wrong — please try again or text Rayvon directly.');
    console.error(error);
  } else {
    alert('Booking request sent! Rayvon will confirm your time by text.');
    form.reset();
    addOnOptions.disabled = false;
    resetTimeOptions('Choose a service and date first');
    availabilityMessage.textContent = 'Choose a service and date to see available appointment times.';
    updateServiceSummary();
  }
});

// ---- Helpers ------------------------------------------------
function timeToMinutes(time) {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function formatTime(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${(h % 12 || 12)}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ---- Boot: load services first, then go ---------------------
loadServices();
