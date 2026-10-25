// script.js — general site behavior (nav, scroll, mobile book bar)

// Smooth scroll for in-page anchor links
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Mobile book bar — hide when the booking section is on screen
const bookBar = document.querySelector('.mobile-book');
const bookingSection = document.getElementById('book');

if (bookBar && bookingSection) {
  const observer = new IntersectionObserver((entries) => {
    bookBar.style.display = entries[0].isIntersecting ? 'none' : 'block';
  });
  observer.observe(bookingSection);
}
