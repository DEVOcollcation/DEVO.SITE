// src/js/components/searchable_select.js
// Custom Searchable Dropdown component that wraps/replaces standard select elements.

function getClippingParent(node) {
    if (!node || node === document.body || node === document.documentElement) {
        return window;
    }
    const style = window.getComputedStyle(node);
    if (!style) return window;
    const overflowY = style.overflowY || style.overflow || "";
    if (overflowY.includes('auto') || overflowY.includes('scroll') || overflowY.includes('hidden')) {
        return node;
    }
    return getClippingParent(node.parentNode || node.host);
}

function getButtonClasses(select) {
    const originalClasses = select.className.split(' ');
    const buttonClasses = ['w-full', 'h-full', 'flex', 'items-center', 'justify-between', 'text-right'];
    
    originalClasses.forEach(cls => {
        // Exclude layout-related and visibility-related classes that go to the container
        if (cls &&
            !cls.startsWith('flex') && 
            !cls.startsWith('w-') && 
            !cls.startsWith('min-w-') && 
            !cls.startsWith('col-') && 
            !cls.startsWith('md:') && 
            !cls.startsWith('lg:') && 
            !cls.startsWith('sm:') &&
            cls !== 'hidden' &&
            cls !== 'block' &&
            cls !== 'inline' &&
            cls !== 'invisible') {
            buttonClasses.push(cls);
        }
    });
    
    return buttonClasses.join(' ');
}

function overrideSelectProperties(select, onValueChange) {
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const originalSelectedIndexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

    Object.defineProperty(select, 'value', {
        get() {
            return originalValueDescriptor.get.call(this);
        },
        set(val) {
            const oldVal = originalValueDescriptor.get.call(this);
            originalValueDescriptor.set.call(this, val);
            const newVal = originalValueDescriptor.get.call(this);
            if (oldVal !== newVal) {
                onValueChange();
            }
        },
        configurable: true
    });

    Object.defineProperty(select, 'selectedIndex', {
        get() {
            return originalSelectedIndexDescriptor.get.call(this);
        },
        set(val) {
            const oldIndex = originalSelectedIndexDescriptor.get.call(this);
            originalSelectedIndexDescriptor.set.call(this, val);
            const newIndex = originalSelectedIndexDescriptor.get.call(this);
            if (oldIndex !== newIndex) {
                onValueChange();
            }
        },
        configurable: true
    });
}

function wrapSelect(select) {
    if (select.dataset.searchableSelectInitialized === "true") return;
    if (select.closest('.searchable-select-container')) return; // skip if already wrapped
    if (select.tagName !== 'SELECT') return;

    select.dataset.searchableSelectInitialized = "true";
    
    // 1. Create container
    const container = document.createElement('div');
    container.className = 'searchable-select-container relative';
    
    // Copy sizing/layout classes to the container
    const originalClasses = select.className.split(' ');
    originalClasses.forEach(cls => {
        if (cls && (cls.startsWith('flex') || cls.startsWith('w-') || cls.startsWith('min-w-') || cls.startsWith('col-') || cls.startsWith('md:') || cls.startsWith('lg:') || cls.startsWith('sm:'))) {
            container.classList.add(cls);
        }
    });
    
    // 2. Insert container before the select and move select into it
    select.parentNode.insertBefore(container, select);
    container.appendChild(select);
    
    // Check initial visibility of the original select (so that hidden selects start hidden)
    if (select.classList.contains('hidden') || select.style.display === 'none') {
        container.classList.add('hidden');
    }
    
    // 3. Hide the select element visually but keep it focusable
    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.overflow = 'hidden';
    select.style.pointerEvents = 'none';
    select.style.zIndex = '-1';
    
    // 4. Create custom button
    const customButton = document.createElement('button');
    customButton.type = 'button';
    customButton.className = getButtonClasses(select);
    
    // Enable or disable based on original select
    if (select.disabled) {
        customButton.disabled = true;
        customButton.classList.add('opacity-70', 'cursor-not-allowed');
    }
    
    const textSpan = document.createElement('span');
    textSpan.className = 'select-text truncate pr-1';
    
    const caretIcon = document.createElement('i');
    caretIcon.className = 'ph ph-caret-down text-devo-muted text-xs select-none transition-transform duration-200';
    
    customButton.appendChild(textSpan);
    customButton.appendChild(caretIcon);
    container.appendChild(customButton);
    
    // 5. Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'absolute left-0 right-0 z-[150] mt-1 bg-devo-dark border border-devo-gray rounded-lg shadow-devo-float overflow-hidden flex flex-col hidden';
    
    // Search input wrapper
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'p-2 border-b border-devo-gray bg-devo-dark sticky top-0 z-10';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'بحث...';
    searchInput.className = 'w-full bg-devo-black border border-devo-gray focus:border-devo-orange outline-none rounded px-2.5 py-1.5 text-white text-xs';
    
    searchWrapper.appendChild(searchInput);
    dropdownMenu.appendChild(searchWrapper);
    
    // Options list container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'overflow-y-auto max-h-60 custom-scrollbar';
    dropdownMenu.appendChild(optionsContainer);
    
    // "No matching results" item
    const noResults = document.createElement('div');
    noResults.className = 'px-3 py-2 text-xs text-devo-muted hidden text-center';
    noResults.textContent = 'لا توجد نتائج مطابقة';
    optionsContainer.appendChild(noResults);
    
    container.appendChild(dropdownMenu);
    
    // Function to populate option items
    function rebuildOptions() {
        // Clear all except noResults
        const items = optionsContainer.querySelectorAll('[data-option-value]');
        items.forEach(item => item.remove());
        
        const selectedVal = select.value;
        let selectedText = '';
        
        Array.from(select.options).forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-right px-3 py-2 text-xs hover:bg-devo-orange hover:text-white transition-colors cursor-pointer text-white flex items-center justify-between';
            btn.setAttribute('data-option-value', opt.value);
            btn.textContent = opt.text;
            
            if (opt.value === selectedVal) {
                btn.classList.add('bg-devo-orange/10', 'text-devo-orange', 'font-bold');
                selectedText = opt.text;
            }
            
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                select.dispatchEvent(new Event('input', { bubbles: true }));
                
                // Close dropdown
                dropdownMenu.classList.add('hidden');
                caretIcon.classList.remove('rotate-180');
                searchInput.value = '';
                filterOptions('');
            });
            
            optionsContainer.insertBefore(btn, noResults);
        });
        
        // Update button text
        textSpan.textContent = selectedText || (select.options[select.selectedIndex]?.text || '');
    }
    
    function filterOptions(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const items = optionsContainer.querySelectorAll('[data-option-value]');
        let hasMatches = false;
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            if (text.includes(normalizedQuery)) {
                item.classList.remove('hidden');
                hasMatches = true;
            } else {
                item.classList.add('hidden');
            }
        });
        
        if (hasMatches) {
            noResults.classList.add('hidden');
        } else {
            noResults.classList.remove('hidden');
        }
    }
    
    function syncDisplay() {
        const selectedVal = select.value;
        let selectedText = '';
        
        const items = optionsContainer.querySelectorAll('[data-option-value]');
        items.forEach(item => {
            const itemVal = item.getAttribute('data-option-value');
            if (itemVal === selectedVal) {
                item.classList.add('bg-devo-orange/10', 'text-devo-orange', 'font-bold');
                item.classList.remove('text-white');
                selectedText = item.textContent;
            } else {
                item.classList.remove('bg-devo-orange/10', 'text-devo-orange', 'font-bold');
                item.classList.add('text-white');
            }
        });
        
        textSpan.textContent = selectedText || (select.options[select.selectedIndex]?.text || '');
    }
    
    // Toggle dropdown
    customButton.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close all other dropdowns first
        document.querySelectorAll('.searchable-select-container .rotate-180').forEach(icon => {
            if (icon !== caretIcon) icon.classList.remove('rotate-180');
        });
        document.querySelectorAll('.searchable-select-container > div:not(.hidden)').forEach(menu => {
            if (menu !== dropdownMenu && menu.parentNode && menu.parentNode.classList.contains('searchable-select-container')) {
                menu.classList.add('hidden');
            }
        });
        
        const isHidden = dropdownMenu.classList.contains('hidden');
        if (isHidden) {
            dropdownMenu.classList.remove('hidden');
            
            // Check position and decide whether to open up or down
            const rect = container.getBoundingClientRect();
            const clippingParent = getClippingParent(container);
            
            let spaceBelow = 0;
            let spaceAbove = 0;
            
            if (clippingParent === window) {
                spaceBelow = window.innerHeight - rect.bottom;
                spaceAbove = rect.top;
            } else {
                const parentRect = clippingParent.getBoundingClientRect();
                spaceBelow = parentRect.bottom - rect.bottom;
                spaceAbove = rect.top - parentRect.top;
            }
            
            // If there's less than 280px below and more space above, open up
            if (spaceBelow < 280 && spaceAbove > spaceBelow) {
                dropdownMenu.classList.remove('mt-1', 'top-full');
                dropdownMenu.classList.add('bottom-full', 'mb-1');
            } else {
                dropdownMenu.classList.remove('bottom-full', 'mb-1');
                dropdownMenu.classList.add('top-full', 'mt-1');
            }
            
            caretIcon.classList.add('rotate-180');
            searchInput.focus();
        } else {
            dropdownMenu.classList.add('hidden');
            caretIcon.classList.remove('rotate-180');
        }
    });
    
    // Filter on search input
    searchInput.addEventListener('input', (e) => {
        filterOptions(e.target.value);
    });
    
    // Prevent closing dropdown when clicking inside it
    dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    // Initial build
    rebuildOptions();
    
    // Override select properties
    overrideSelectProperties(select, () => {
        syncDisplay();
    });
    
    // Setup MutationObserver
    let isSyncing = false;
    const observer = new MutationObserver((mutations) => {
        if (isSyncing) return;
        let rebuild = false;
        let syncDisabled = false;
        let syncClasses = false;
        
        mutations.forEach(m => {
            if (m.type === 'childList') rebuild = true;
            if (m.type === 'attributes') {
                if (m.attributeName === 'disabled') syncDisabled = true;
                if (m.attributeName === 'class' || m.attributeName === 'style') syncClasses = true;
            }
        });
        
        isSyncing = true;
        try {
            if (rebuild) {
                rebuildOptions();
            }
            if (syncDisabled) {
                customButton.disabled = select.disabled;
                if (select.disabled) {
                    customButton.classList.add('opacity-70', 'cursor-not-allowed');
                } else {
                    customButton.classList.remove('opacity-70', 'cursor-not-allowed');
                }
            }
            if (syncClasses) {
                const isHidden = select.classList.contains('hidden') || select.style.display === 'none';
                if (isHidden && !container.classList.contains('hidden')) {
                    container.classList.add('hidden');
                } else if (!isHidden && container.classList.contains('hidden')) {
                    container.classList.remove('hidden');
                }
            }
        } finally {
            isSyncing = false;
        }
    });
    observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled', 'class', 'style'] });
}

function wrapMultiSelectDropdown(dropdown) {
    if (dropdown.dataset.multiSelectSearchInitialized === "true") return;
    dropdown.dataset.multiSelectSearchInitialized = "true";

    const menu = dropdown.querySelector('div[id$="-menu"]');
    if (!menu) return;

    const optionsContainer = menu.querySelector('div[id$="-options"]');
    if (!optionsContainer) return;

    // Create search wrapper
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'px-2 pb-2 border-b border-devo-gray/30 mb-1';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'بحث...';
    searchInput.className = 'w-full bg-devo-black border border-devo-gray focus:border-devo-orange outline-none rounded px-2.5 py-1.5 text-white text-xs';
    
    searchWrapper.appendChild(searchInput);

    // Insert searchWrapper before optionsContainer
    menu.insertBefore(searchWrapper, optionsContainer);

    // Create "No matching results" container
    const noResults = document.createElement('div');
    noResults.className = 'px-2 py-1.5 text-xs text-devo-muted hidden text-center';
    noResults.textContent = 'لا توجد نتائج مطابقة';
    menu.appendChild(noResults);

    // Prevent click on search input from closing the dropdown
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    const filterOptions = () => {
        const query = searchInput.value.toLowerCase().trim();
        const labels = optionsContainer.querySelectorAll('label');
        let hasMatches = false;

        labels.forEach(label => {
            const span = label.querySelector('span');
            const text = span ? span.textContent.toLowerCase() : '';
            if (text.includes(query)) {
                label.classList.remove('hidden');
                label.classList.add('flex');
                hasMatches = true;
            } else {
                label.classList.remove('flex');
                label.classList.add('hidden');
            }
        });

        if (hasMatches || labels.length === 0) {
            noResults.classList.add('hidden');
        } else {
            noResults.classList.remove('hidden');
        }
    };

    searchInput.addEventListener('input', filterOptions);

    // Reset search on dropdown close, and position dynamically on open
    let isUpdatingPosition = false;
    const menuObserver = new MutationObserver((mutations) => {
        if (isUpdatingPosition) return;
        mutations.forEach(m => {
            if (m.type === 'attributes' && m.attributeName === 'class') {
                if (menu.classList.contains('hidden')) {
                    searchInput.value = '';
                    filterOptions();
                } else {
                    isUpdatingPosition = true;
                    try {
                        // Position dynamically on open
                        const rect = dropdown.getBoundingClientRect();
                        const clippingParent = getClippingParent(dropdown);
                        
                        let spaceBelow = 0;
                        let spaceAbove = 0;
                        
                        if (clippingParent === window) {
                            spaceBelow = window.innerHeight - rect.bottom;
                            spaceAbove = rect.top;
                        } else {
                            const parentRect = clippingParent.getBoundingClientRect();
                            spaceBelow = parentRect.bottom - rect.bottom;
                            spaceAbove = rect.top - parentRect.top;
                        }
                        
                        if (spaceBelow < 280 && spaceAbove > spaceBelow) {
                            if (!menu.classList.contains('bottom-full')) {
                                menu.classList.remove('mt-1', 'top-full');
                                menu.classList.add('bottom-full', 'mb-1');
                            }
                        } else {
                            if (!menu.classList.contains('top-full')) {
                                menu.classList.remove('bottom-full', 'mb-1');
                                menu.classList.add('top-full', 'mt-1');
                            }
                        }
                    } finally {
                        isUpdatingPosition = false;
                    }
                }
            }
        });
    });
    menuObserver.observe(menu, { attributes: true, attributeFilter: ['class'] });
}

// Global click handler to close dropdowns when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.searchable-select-container > div:not(.hidden)').forEach(menu => {
        if (menu.parentNode && menu.parentNode.classList.contains('searchable-select-container')) {
            menu.classList.add('hidden');
            const caret = menu.parentNode.querySelector('.rotate-180');
            if (caret) caret.classList.remove('rotate-180');
        }
    });
});

// Setup Global MutationObserver to automatically wrap new selects and multi-selects
const globalObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'SELECT') {
                    wrapSelect(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('select').forEach(select => wrapSelect(select));
                }

                if (node.classList && node.classList.contains('multi-select-dropdown')) {
                    wrapMultiSelectDropdown(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('.multi-select-dropdown').forEach(dropdown => wrapMultiSelectDropdown(dropdown));
                }
            }
        });
    });
});
globalObserver.observe(document.body, { childList: true, subtree: true });

// Scan and wrap existing elements
const initAll = () => {
    document.querySelectorAll('select').forEach(select => wrapSelect(select));
    document.querySelectorAll('.multi-select-dropdown').forEach(dropdown => wrapMultiSelectDropdown(dropdown));
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initAll();
} else {
    document.addEventListener('DOMContentLoaded', initAll);
}
