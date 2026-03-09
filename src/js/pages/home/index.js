import { initNavbar } from './navbar.js';
import { initGallery } from './gallery.js';
import { initHomeContent } from './home_content.js';
import { initCart } from './cart.js';
import { initOrdersView } from './orders.js';
document.addEventListener('DOMContentLoaded', async () => {
    initNavbar();
    await initHomeContent();
    await initGallery();
    initCart();
    await initOrdersView();
});