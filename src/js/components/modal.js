/**
 * DEVO Custom Confirm Dialog
 * Replaces native window.confirm() using Promises for clean async/await usage
 */

export function confirmDialog({ 
    title = 'تأكيد الإجراء', 
    message = 'هل أنت متأكد من القيام بهذا الإجراء؟ لا يمكن التراجع عنه.', 
    confirmText = 'نعم، متأكد', 
    cancelText = 'إلغاء',
    isDestructive = true // If true, confirm button is red. If false, it's DEVO orange.
}) {
    return new Promise((resolve) => {
        // 1. Create Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center opacity-0 transition-opacity duration-300';
        
        // 2. Define colors based on action type
        const iconColor = isDestructive ? 'text-devo-error bg-devo-error/10' : 'text-devo-warning bg-devo-warning/10';
        const btnClass = isDestructive 
            ? 'bg-devo-error hover:bg-red-700 text-white' 
            : 'bg-devo-orange hover:bg-devo-orangeHover text-white';

        // 3. Create Modal Content
        const modal = document.createElement('div');
        modal.className = 'bg-devo-dark border border-devo-gray rounded-xl w-full max-w-sm p-6 text-center transform scale-95 transition-transform duration-300 shadow-devo-float';
        
        modal.innerHTML = `
            <div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${iconColor}">
                <i class="ph ph-warning-circle text-3xl"></i>
            </div>
            <h3 class="text-xl font-bold text-devo-text mb-2">${title}</h3>
            <p class="text-devo-muted mb-6 text-sm leading-relaxed">${message}</p>
            <div class="flex justify-center gap-3">
                <button id="devo-cancel-btn" class="px-5 py-2 rounded-lg border border-devo-gray text-devo-text hover:bg-devo-gray transition-colors font-medium w-1/2">
                    ${cancelText}
                </button>
                <button id="devo-confirm-btn" class="px-5 py-2 rounded-lg transition-colors font-medium w-1/2 ${btnClass}">
                    ${confirmText}
                </button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // 4. Animate In
        requestAnimationFrame(() => {
            setTimeout(() => {
                backdrop.classList.remove('opacity-0');
                modal.classList.remove('scale-95');
            }, 10);
        });

        // 5. Clean up and Resolve logic
        const closeAndResolve = (result) => {
            // Animate Out
            backdrop.classList.add('opacity-0');
            modal.classList.add('scale-95');
            
            // Wait for transition, then remove from DOM and resolve Promise
            setTimeout(() => {
                backdrop.remove();
                resolve(result);
            }, 300);
        };

        // 6. Event Listeners
        const confirmBtn = modal.querySelector('#devo-confirm-btn');
        const cancelBtn = modal.querySelector('#devo-cancel-btn');

        confirmBtn.addEventListener('click', () => closeAndResolve(true));
        cancelBtn.addEventListener('click', () => closeAndResolve(false));
        
        // Allow clicking outside the modal to cancel
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeAndResolve(false);
        });
    });
}

// Attach to window object for global access if needed in inline HTML
window.confirmDialog = confirmDialog;