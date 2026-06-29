// ========================================================
// 📊 DEVO Collection - Table Sorter Component
// ========================================================

window.customSortHandlers = window.customSortHandlers || {};

function performDomSort(table, colIndex, direction) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    // Filter out helper rows like "no data" or loading spinners
    const dataRows = rows.filter(row => {
        return !row.classList.contains('no-data-row') && 
               !row.classList.contains('no-results') && 
               !row.querySelector('td[colspan]');
    });

    if (dataRows.length === 0) return;

    dataRows.sort((rowA, rowB) => {
        const cellA = rowA.children[colIndex];
        const cellB = rowB.children[colIndex];
        
        let textA = cellA ? cellA.innerText.trim() : '';
        let textB = cellB ? cellB.innerText.trim() : '';

        // Check if values are numeric
        const numA = parseFloat(textA.replace(/[^\d.-]/g, ''));
        const numB = parseFloat(textB.replace(/[^\d.-]/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return direction === 'asc' ? numA - numB : numB - numA;
        }

        // Check if values are dates
        const dateA = Date.parse(textA);
        const dateB = Date.parse(textB);
        if (!isNaN(dateA) && !isNaN(dateB)) {
            return direction === 'asc' ? dateA - dateB : dateB - dateA;
        }

        return direction === 'asc' ? textA.localeCompare(textB, 'ar') : textB.localeCompare(textA, 'ar');
    });

    // Re-append rows in sorted order
    dataRows.forEach(row => tbody.appendChild(row));
}

function initTableHeaders(table) {
    // If table has already been initialized, skip
    if (table.dataset.sortInitialized === "true") return;
    table.dataset.sortInitialized = "true";

    const headers = table.querySelectorAll('thead th');
    const tableId = table.id;

    headers.forEach((th, index) => {
        const text = th.innerText.trim();
        
        // Skip Actions columns, checkbox selection columns, or empty headers
        if (text === '' || 
            text === 'الإجراءات' || 
            text.toLowerCase().includes('action') || 
            th.querySelector('input[type="checkbox"]') ||
            th.classList.contains('no-sort')) {
            return;
        }

        th.style.cursor = 'pointer';
        th.classList.add('select-none', 'hover:text-devo-orange', 'transition-colors');

        // Append arrow indicator placeholder
        let indicator = th.querySelector('.sort-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'sort-indicator mr-1 text-[10px] opacity-40 transition-opacity inline-block';
            indicator.innerHTML = ' ⇅';
            th.appendChild(indicator);
        }

        th.addEventListener('click', () => {
            let currentDir = th.getAttribute('data-sort-dir');
            let nextDir = currentDir === 'asc' ? 'desc' : 'asc';
            
            // Reset direction and indicators on all sibling headers
            headers.forEach(siblingTh => {
                siblingTh.removeAttribute('data-sort-dir');
                const siblingInd = siblingTh.querySelector('.sort-indicator');
                if (siblingInd) {
                    siblingInd.innerHTML = ' ⇅';
                    siblingInd.className = 'sort-indicator mr-1 text-[10px] opacity-40 transition-opacity inline-block';
                }
            });

            // Set state on current header
            th.setAttribute('data-sort-dir', nextDir);
            indicator.className = 'sort-indicator mr-1 text-[10px] text-devo-orange opacity-100 inline-block font-bold';
            indicator.innerHTML = nextDir === 'asc' ? ' ▲' : ' ▼';

            // Dispatch sorting
            if (tableId && window.customSortHandlers[tableId]) {
                window.customSortHandlers[tableId](index, nextDir);
            } else {
                performDomSort(table, index, nextDir);
            }
        });
    });
}

// Global MutationObserver to automatically bind to new tables
const tableObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'TABLE') {
                    initTableHeaders(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('table').forEach(table => initTableHeaders(table));
                }
            }
        });
    });
});
tableObserver.observe(document.body, { childList: true, subtree: true });

// Initialize existing tables
const initAllTables = () => {
    document.querySelectorAll('table').forEach(table => initTableHeaders(table));
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initAllTables();
} else {
    document.addEventListener('DOMContentLoaded', initAllTables);
}
