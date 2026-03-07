/**
 * DEVO Toast Notification System
 * Premium UI component replacing native window.alert()
 */

export function showToast(message, type = 'success') {
    // 1. Ensure the toast container exists in the DOM
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        // Fixed position at bottom-left, stack vertically, ensure it floats above everything
        container.className = 'fixed bottom-6 left-6 z-[100] flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(container);
    }

    // 2. Create the toast element
    const toast = document.createElement('div');
    
    // 3. Define styles and Phosphor icons based on notification type
    const config = {
        success: { icon: 'ph-check-circle', color: 'text-devo-success', border: 'border-devo-success/20' },
        error:   { icon: 'ph-warning-circle', color: 'text-devo-error', border: 'border-devo-error/20' },
        warning: { icon: 'ph-warning', color: 'text-devo-warning', border: 'border-devo-warning/20' },
        info:    { icon: 'ph-info', color: 'text-devo-info', border: 'border-devo-info/20' }
    };

    const style = config[type] || config.success;

    // 4. Apply DEVO Brand Styling (Dark mode, elegant float shadow)
    toast.className = `flex items-center gap-3 px-4 py-3 bg-devo-dark border ${style.border} rounded-lg shadow-devo-float transform translate-y-10 opacity-0 transition-all duration-300 min-w-[250px] max-w-sm pointer-events-auto`;
    
    toast.innerHTML = `
        <i class="ph ${style.icon} text-xl ${style.color}"></i>
        <span class="text-devo-text text-sm font-medium leading-relaxed">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // 5. Animate In (Delay slightly to allow DOM to register the starting classes)
    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.remove('translate-y-10', 'opacity-0');
        }, 10);
    });
    
    // 6. Auto-dismiss and Animate Out after 3.5 seconds
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        // Wait for CSS transition to finish before removing from DOM
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Attach to window object for global access (useful for inline HTML onclick handlers if needed)
window.showToast = showToast;