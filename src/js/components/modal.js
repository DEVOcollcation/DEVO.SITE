/**
 * DEVO Custom Confirm & Prompt Dialogs System
 * Replaces native window.confirm() and window.prompt() with sleek, custom DEVO styled dialogs using Promises.
 */

export function confirmDialog(options = {}) {
    let title = 'تأكيد الإجراء';
    let message = 'هل أنت متأكد من القيام بهذا الإجراء؟ لا يمكن التراجع عنه.';
    let confirmText = 'نعم، متأكد';
    let cancelText = 'إلغاء';
    let isDestructive = true;

    if (typeof options === 'string') {
        message = options;
    } else if (typeof options === 'object' && options !== null) {
        if (options.title !== undefined) title = options.title;
        if (options.message !== undefined) message = options.message;
        if (options.confirmText !== undefined) confirmText = options.confirmText;
        if (options.cancelText !== undefined) cancelText = options.cancelText;
        if (options.isDestructive !== undefined) isDestructive = options.isDestructive;
    }

    return new Promise((resolve) => {
        // 1. Create Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center opacity-0 transition-opacity duration-300 p-4';
        
        // 2. Define colors based on action type
        const iconColor = isDestructive ? 'text-devo-error bg-devo-error/10' : 'text-devo-orange bg-devo-orange/10';
        const iconClass = isDestructive ? 'ph-warning-circle' : 'ph-question';
        const btnClass = isDestructive 
            ? 'bg-devo-error hover:bg-red-700 text-white shadow-lg shadow-red-500/20' 
            : 'bg-devo-orange hover:bg-devo-orangeHover text-white shadow-lg shadow-amber-500/20';

        // 3. Formatted Message with line breaks
        const formattedMessage = message.replace(/\n/g, '<br>');

        // 4. Create Modal Content
        const modal = document.createElement('div');
        modal.className = 'bg-devo-dark border border-devo-gray rounded-xl w-full max-w-sm p-6 text-center transform scale-95 transition-transform duration-300 shadow-devo-float';
        
        modal.innerHTML = `
            <div class="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${iconColor}">
                <i class="ph ${iconClass} text-3xl"></i>
            </div>
            <h3 class="text-xl font-bold text-devo-text mb-2 leading-tight">${title}</h3>
            <p class="text-devo-muted mb-6 text-sm leading-relaxed">${formattedMessage}</p>
            <div class="flex justify-center gap-3">
                <button id="devo-cancel-btn" class="px-4 py-2.5 rounded-lg border border-devo-gray text-devo-text hover:bg-devo-gray transition-colors font-medium w-1/2 text-sm">
                    ${cancelText}
                </button>
                <button id="devo-confirm-btn" class="px-4 py-2.5 rounded-lg transition-colors font-medium w-1/2 text-sm ${btnClass}">
                    ${confirmText}
                </button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // 5. Animate In
        requestAnimationFrame(() => {
            setTimeout(() => {
                backdrop.classList.remove('opacity-0');
                modal.classList.remove('scale-95');
            }, 10);
        });

        // 6. Clean up and Resolve logic
        const closeAndResolve = (result) => {
            backdrop.classList.add('opacity-0');
            modal.classList.add('scale-95');
            
            setTimeout(() => {
                backdrop.remove();
                resolve(result);
            }, 300);
        };

        // 7. Event Listeners
        const confirmBtn = modal.querySelector('#devo-confirm-btn');
        const cancelBtn = modal.querySelector('#devo-cancel-btn');

        confirmBtn.addEventListener('click', () => closeAndResolve(true));
        cancelBtn.addEventListener('click', () => closeAndResolve(false));
        
        // Escape key to cancel
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleKeyDown);
                closeAndResolve(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        // Allow clicking outside the modal to cancel
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                document.removeEventListener('keydown', handleKeyDown);
                closeAndResolve(false);
            }
        });
    });
}

export function promptDialog(options = {}) {
    let title = 'إدخال بيانات';
    let message = '';
    let defaultValue = '';
    let placeholder = '';
    let confirmText = 'تأكيد';
    let cancelText = 'إلغاء';

    if (typeof options === 'string') {
        message = options;
        if (arguments.length > 1 && typeof arguments[1] === 'string') {
            defaultValue = arguments[1];
        }
    } else if (typeof options === 'object' && options !== null) {
        if (options.title !== undefined) title = options.title;
        if (options.message !== undefined) message = options.message;
        if (options.defaultValue !== undefined) defaultValue = options.defaultValue;
        if (options.placeholder !== undefined) placeholder = options.placeholder;
        if (options.confirmText !== undefined) confirmText = options.confirmText;
        if (options.cancelText !== undefined) cancelText = options.cancelText;
    }

    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center opacity-0 transition-opacity duration-300 p-4';

        const formattedMessage = message ? message.replace(/\n/g, '<br>') : '';

        const modal = document.createElement('div');
        modal.className = 'bg-devo-dark border border-devo-gray rounded-xl w-full max-w-sm p-6 transform scale-95 transition-transform duration-300 shadow-devo-float';

        modal.innerHTML = `
            <div class="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-devo-orange bg-devo-orange/10">
                <i class="ph ph-note-pencil text-3xl"></i>
            </div>
            <h3 class="text-xl font-bold text-devo-text mb-2 text-center leading-tight">${title}</h3>
            ${formattedMessage ? `<p class="text-devo-muted mb-4 text-sm leading-relaxed text-center">${formattedMessage}</p>` : ''}
            <div class="mb-6">
                <input type="text" id="devo-prompt-input" value="${defaultValue}" placeholder="${placeholder}" class="w-full px-4 py-2.5 bg-devo-card border border-devo-gray rounded-lg text-devo-text focus:outline-none focus:border-devo-orange text-sm dir-auto" />
            </div>
            <div class="flex justify-center gap-3">
                <button id="devo-prompt-cancel-btn" class="px-4 py-2.5 rounded-lg border border-devo-gray text-devo-text hover:bg-devo-gray transition-colors font-medium w-1/2 text-sm">
                    ${cancelText}
                </button>
                <button id="devo-prompt-confirm-btn" class="px-4 py-2.5 rounded-lg bg-devo-orange hover:bg-devo-orangeHover text-white transition-colors font-medium w-1/2 text-sm shadow-lg shadow-amber-500/20">
                    ${confirmText}
                </button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        const inputEl = modal.querySelector('#devo-prompt-input');

        requestAnimationFrame(() => {
            setTimeout(() => {
                backdrop.classList.remove('opacity-0');
                modal.classList.remove('scale-95');
                inputEl.focus();
                inputEl.select();
            }, 10);
        });

        const closeAndResolve = (value) => {
            backdrop.classList.add('opacity-0');
            modal.classList.add('scale-95');
            setTimeout(() => {
                backdrop.remove();
                resolve(value);
            }, 300);
        };

        const confirmBtn = modal.querySelector('#devo-prompt-confirm-btn');
        const cancelBtn = modal.querySelector('#devo-prompt-cancel-btn');

        confirmBtn.addEventListener('click', () => closeAndResolve(inputEl.value));
        cancelBtn.addEventListener('click', () => closeAndResolve(null));

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                closeAndResolve(inputEl.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeAndResolve(null);
            }
        });

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeAndResolve(null);
        });
    });
}

// Attach to window object for global access
window.confirmDialog = confirmDialog;
window.promptDialog = promptDialog;