import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

// Elements
let isInitialized = false;

export async function initUsersView() {
    // Prevent fetching data multiple times if view is already loaded
    if (isInitialized) return; 

    loadUsers();
    setupEventListeners();
    
    isInitialized = true;
}

async function loadUsers() {
    const tableBody = document.getElementById('users-table-body');
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center p-4">Loading...</td></tr>`;
    
    // Fetch logic here...
}

function setupEventListeners() {
    const userForm = document.getElementById('user-form');
    if (userForm) {
        userForm.addEventListener('submit', handleUserCreate);
    }
}

async function handleUserCreate(e) {
    e.preventDefault();
    // Logic to create user...
}