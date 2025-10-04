// Discord Translator Extension - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
    const openOptionsBtn = document.getElementById('openOptions');
    const extensionStatus = document.getElementById('extensionStatus');
    const translationMode = document.getElementById('translationMode');

    // Event listeners
    openOptionsBtn.addEventListener('click', openOptionsPage);
    
    // Copy button functionality
    const copyBtn = document.getElementById('popupCopyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyEvmAddress);
    }

    // Load current status and language
    await loadStatus();
    await loadLanguagePreference();

    function openOptionsPage() {
        chrome.runtime.openOptionsPage();
        window.close();
    }

    async function loadStatus() {
        try {
            // Test if extension is working
            const response = await sendMessage({ action: 'getSettings' });
            
            if (response && response.success) {
                const currentLang = localStorage.getItem('discord-translator-language') || 'en';
                extensionStatus.textContent = currentLang === 'tr' ? 'Aktif' : 'Active';
                extensionStatus.style.background = 'rgba(76, 175, 80, 0.3)';
                
                // Show translation mode
                const mode = response.settings.readingMode === 'auto' 
                    ? (currentLang === 'tr' ? 'Otomatik' : 'Auto') 
                    : (currentLang === 'tr' ? 'Tıkla-Çevir' : 'Click to Translate');
                translationMode.textContent = mode;
            } else {
                throw new Error('Settings could not be loaded');
            }
        } catch (error) {
            console.error('Error loading status:', error);
            const currentLang = localStorage.getItem('discord-translator-language') || 'en';
            extensionStatus.textContent = currentLang === 'tr' ? 'Hata' : 'Error';
            extensionStatus.style.background = 'rgba(244, 67, 54, 0.3)';
            translationMode.textContent = currentLang === 'tr' ? 'Bilinmiyor' : 'Unknown';
        }
    }

    // Language preference loading function
    async function loadLanguagePreference() {
        try {
            const savedLang = localStorage.getItem('discord-translator-language') || 'en';
            await applyLanguage(savedLang);
        } catch (error) {
            console.error('Error loading language preference:', error);
            await applyLanguage('en');
        }
    }

    async function applyLanguage(lang) {
        try {
            // Update all elements with data attributes
            const elements = document.querySelectorAll('[data-tr][data-en]');
            elements.forEach(element => {
                const text = element.getAttribute(`data-${lang}`);
                if (text) {
                    element.textContent = text;
                }
            });

            // Update document title
            document.title = lang === 'en' ? 'Discord Translator' : 'Discord Translator';

            // Update HTML lang attribute
            document.documentElement.lang = lang;

            // Reload status to update dynamic text
            await loadStatus();

            console.log(`Popup language applied: ${lang}`);
        } catch (error) {
            console.error('Error applying language:', error);
        }
    }

    // Copy EVM address function
    async function copyEvmAddress() {
        try {
            const address = document.getElementById('popupEvmAddress').textContent;
            await navigator.clipboard.writeText(address);

            // Visual feedback
            const copyBtn = document.getElementById('popupCopyBtn');
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅';
            copyBtn.classList.add('copied');

            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('copied');
            }, 2000);

            console.log('EVM address copied to clipboard');
        } catch (error) {
            console.error('Failed to copy address:', error);
        }
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (!chrome || !chrome.runtime) {
                reject(new Error('Chrome runtime not available'));
                return;
            }
            
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                resolve(response || { success: false, error: 'No response received' });
            });
        });
    }
});