// Discord Translator Extension - Options Page Script

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Options page loaded');

    // Get form elements
    const form = {
        readingModeAuto: document.getElementById('readingModeAuto'),
        readingModeClick: document.getElementById('readingModeClick'),
        readingTargetLang: document.getElementById('readingTargetLang'),
        writingEnabled: document.getElementById('writingEnabled'),
        writingTargetLang: document.getElementById('writingTargetLang')
    };

    // Shortcut recorder elements
    const shortcutElements = {
        display: document.getElementById('shortcutDisplay'),
        text: document.getElementById('shortcutText'),
        recordBtn: document.getElementById('recordShortcutBtn'),
        recorder: document.getElementById('shortcutRecorder'),
        cancelBtn: document.getElementById('cancelRecordBtn'),
        resetBtn: document.getElementById('resetShortcutBtn')
    };

    // Shortcut recording state
    let isRecordingShortcut = false;
    let currentShortcut = null;

    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const statusDiv = document.getElementById('status');
    const copyAddressBtn = document.getElementById('copyAddressBtn');
    const evmAddress = document.getElementById('evmAddress');

    // Language elements
    const langEnBtn = document.getElementById('langEn');
    const langTrBtn = document.getElementById('langTr');

    // Test background script connection first
    try {
        console.log('Testing background script connection...');
        const testResponse = await sendMessage({ action: 'test' });
        console.log('Test response:', testResponse);
    } catch (error) {
        console.error('Background script connection test failed:', error);
    }

    // Load current settings
    await loadSettings();

    // Load language preference and set initial language
    await loadLanguagePreference();
    
    // PNG flag icons are now used instead of emoji fixes
    console.log('Using PNG flag icons from icons/flags/ directory');
    
    // Setup custom dropdowns with flag icons
    setupCustomDropdowns();

    // Debug: Test if shortcut elements exist
    console.log('Shortcut elements check:', {
        display: shortcutElements.display,
        text: shortcutElements.text,
        recordBtn: shortcutElements.recordBtn,
        recorder: shortcutElements.recorder,
        cancelBtn: shortcutElements.cancelBtn,
        resetBtn: shortcutElements.resetBtn
    });

    // Event listeners
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);
    copyAddressBtn.addEventListener('click', copyEvmAddress);
    langEnBtn.addEventListener('click', () => switchLanguage('en'));
    langTrBtn.addEventListener('click', () => switchLanguage('tr'));

    // Shortcut recorder event listeners
    shortcutElements.recordBtn.addEventListener('click', startShortcutRecording);
    shortcutElements.cancelBtn.addEventListener('click', cancelShortcutRecording);
    shortcutElements.resetBtn.addEventListener('click', resetShortcutToDefault);

    // Global keydown listener for shortcut recording
    document.addEventListener('keydown', handleShortcutRecording);

    // Auto-save on change (optional) and form validation feedback
    Object.values(form).forEach(element => {
        element.addEventListener('change', () => {
            // Clear status message when user makes changes
            showStatus('', '');

            // Add visual feedback for form validation
            validateFormVisually();
        });
    });

    // API key input removed - now hardcoded

    async function loadSettings() {
        try {
            console.log('Starting loadSettings...');
            showStatus(getTranslatedText('Ayarlar yükleniyor...', 'Loading settings...'), 'info');

            console.log('Sending getSettings message...');
            const response = await sendMessage({ action: 'getSettings' });
            console.log('Received response in loadSettings:', response);

            if (!response) {
                throw new Error('No response received from background script');
            }

            if (!response.success) {
                throw new Error(response.error || 'Settings could not be loaded');
            }

            const settings = response.settings;
            console.log('Settings to load:', settings);

            if (!settings) {
                throw new Error('No settings data received');
            }

            // Validate and set reading mode
            if (settings.readingMode === 'auto') {
                form.readingModeAuto.checked = true;
            } else if (settings.readingMode === 'click') {
                form.readingModeClick.checked = true;
            } else {
                console.warn('Invalid reading mode, defaulting to auto');
                form.readingModeAuto.checked = true;
            }

        // Set target languages for custom dropdowns
        setCustomDropdownValue('readingTargetLang', validateLanguage(settings.readingTargetLang, 'tr'));
        setCustomDropdownValue('writingTargetLang', validateLanguage(settings.writingTargetLang, 'en'));

            // Set writing enabled
            form.writingEnabled.checked = Boolean(settings.writingEnabled);

            // Load custom shortcut
            if (settings.customShortcut) {
                currentShortcut = settings.customShortcut;
                updateShortcutDisplay(settings.customShortcut);
            } else {
                // Default shortcut
                const defaultShortcut = { ctrl: true, shift: false, alt: false, key: 'i' };
                currentShortcut = defaultShortcut;
                updateShortcutDisplay(defaultShortcut);
            }

            console.log('Settings loaded successfully:', settings);
            showStatus(getTranslatedText('Ayarlar başarıyla yüklendi', 'Settings loaded successfully'), 'success');

            // Perform initial visual validation
            validateFormVisually();

            // Clear status after 4 seconds (increased from 2 seconds)
            setTimeout(() => showStatus('', ''), 4000);

        } catch (error) {
            console.error('Error loading settings:', error);
            console.error('Error stack:', error.stack);
            showStatus(`${getTranslatedText('Ayarlar yüklenirken hata oluştu:', 'Error loading settings:')} ${error.message}`, 'error');

            // Try to load default settings as fallback
            console.log('Attempting to load default settings...');
            try {
                form.readingModeClick.checked = true;
                form.readingTargetLang.value = 'tr';
                form.writingTargetLang.value = 'en';
                form.writingEnabled.checked = true;
                showStatus(getTranslatedText('Varsayılan ayarlar yüklendi', 'Default settings loaded'), 'info');
            } catch (fallbackError) {
                console.error('Failed to load default settings:', fallbackError);
            }
        }
    }

    async function saveSettings() {
        try {
            // Validate form inputs before saving
            const validationErrors = validateForm();
            if (validationErrors.length > 0) {
                throw new Error(`${getTranslatedText('Geçersiz ayarlar:', 'Invalid settings:')} ${validationErrors.join(', ')}`);
            }

            // Add loading state to save button
            saveBtn.classList.add('loading');
            saveBtn.disabled = true;
            showStatus(getTranslatedText('Ayarlar kaydediliyor...', 'Saving settings...'), 'info');

            const settings = {
                readingMode: form.readingModeAuto.checked ? 'auto' : 'click',
                readingTargetLang: getCustomDropdownValue('readingTargetLang'),
                writingEnabled: form.writingEnabled.checked,
                writingTargetLang: getCustomDropdownValue('writingTargetLang'),
                customShortcut: currentShortcut || { ctrl: true, shift: false, alt: false, key: 'i' }
            };

            const response = await sendMessage({
                action: 'saveSettings',
                settings: settings
            });

            if (!response.success) {
                throw new Error(response.error || 'Settings could not be saved');
            }

            console.log('Settings saved successfully:', response.settings);
            showStatus(getTranslatedText('Ayarlar başarıyla kaydedildi!', 'Settings saved successfully!'), 'success');
            
            // Open Discord in new tab after successful save
            setTimeout(() => {
                window.open('https://discord.com/channels/@me', '_blank');
            }, 1000);

        } catch (error) {
            console.error('Error saving settings:', error);
            showStatus(`${getTranslatedText('Ayarlar kaydedilirken hata oluştu:', 'Error saving settings:')} ${error.message}`, 'error');
        } finally {
            // Remove loading state
            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;
            validateFormVisually(); // Re-validate to set proper button state
        }
    }

    async function resetSettings() {
        if (confirm(getTranslatedText('Tüm ayarları sıfırlamak istediğinizden emin misiniz?', 'Are you sure you want to reset all settings?'))) {
            try {
                // Add loading state to reset button
                resetBtn.classList.add('loading');
                resetBtn.disabled = true;
                showStatus(getTranslatedText('Ayarlar sıfırlanıyor...', 'Resetting settings...'), 'info');

                const response = await sendMessage({ action: 'resetSettings' });

                if (!response.success) {
                    throw new Error(response.error || 'Settings could not be reset');
                }

                console.log('Settings reset successfully:', response.settings);
                showStatus(getTranslatedText('Ayarlar başarıyla sıfırlandı!', 'Settings reset successfully!'), 'success');

                // Reload settings in the form
                setTimeout(() => {
                    loadSettings();
                }, 1000);

            } catch (error) {
                console.error('Error resetting settings:', error);
                showStatus(`${getTranslatedText('Ayarlar sıfırlanırken hata oluştu:', 'Error resetting settings:')} ${error.message}`, 'error');
            } finally {
                // Remove loading state
                resetBtn.classList.remove('loading');
                resetBtn.disabled = false;
            }
        }
    }

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;

        // Clear message after 5 seconds (increased from 3 seconds)
        if (message) {
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = 'status-message';
            }, 5000);
        }
    }

    // Validation functions
    function validateLanguage(lang, defaultLang) {
        const supportedLanguages = [
            'tr', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar'
        ];

        return supportedLanguages.includes(lang) ? lang : defaultLang;
    }

    function validateForm() {
        const errors = [];

        // Validate reading target language
        if (!form.readingTargetLang.value) {
            errors.push(getTranslatedText('Okuma hedef dili seçilmelidir', 'Reading target language must be selected'));
        }

        // Validate writing target language
        if (!form.writingTargetLang.value) {
            errors.push(getTranslatedText('Yazma hedef dili seçilmelidir', 'Writing target language must be selected'));
        }

        // API key validation removed - now hardcoded

        return errors;
    }

    // Visual validation functions
    function validateFormVisually() {
        const errors = validateForm();

        // Update save button state
        saveBtn.disabled = errors.length > 0;

        if (errors.length > 0) {
            saveBtn.style.opacity = '0.6';
            saveBtn.title = `${getTranslatedText('Kaydetmek için şu sorunları çözün:', 'Fix the following issues to save:')} ${errors.join(', ')}`;
        } else {
            saveBtn.style.opacity = '1';
            saveBtn.title = getTranslatedText('Ayarları kaydet', 'Save settings');
        }
    }

    // API key visual validation removed - now hardcoded

    // Copy EVM address function
    async function copyEvmAddress() {
        try {
            const address = evmAddress.textContent;
            await navigator.clipboard.writeText(address);

            // Visual feedback
            const originalText = copyAddressBtn.textContent;
            copyAddressBtn.textContent = '✅';
            copyAddressBtn.style.background = 'rgba(76, 175, 80, 0.3)';

            setTimeout(() => {
                copyAddressBtn.textContent = originalText;
                copyAddressBtn.style.background = '';
            }, 2000);

            showStatus(getTranslatedText('EVM adresi panoya kopyalandı!', 'EVM address copied to clipboard!'), 'success');
        } catch (error) {
            console.error('Failed to copy address:', error);
            showStatus(getTranslatedText('Adres kopyalanamadı. Lütfen manuel olarak kopyalayın.', 'Address could not be copied. Please copy manually.'), 'error');
        }
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            console.log('Sending message:', message);

            // Check if chrome.runtime is available
            if (!chrome || !chrome.runtime) {
                reject(new Error('Chrome runtime not available'));
                return;
            }

            chrome.runtime.sendMessage(message, (response) => {
                console.log('Received response:', response);
                console.log('Last error:', chrome.runtime.lastError);

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                // Ensure we always have a response object
                resolve(response || { success: false, error: 'No response received' });
            });
        });
    }

    // Helper function to get translated text based on current language
    function getTranslatedText(turkishText, englishText) {
        const currentLang = localStorage.getItem('discord-translator-language') || 'en';
        return currentLang === 'tr' ? turkishText : englishText;
    }

    // Language switching functions
    async function loadLanguagePreference() {
        try {
            const savedLang = localStorage.getItem('discord-translator-language') || 'en';
            await switchLanguage(savedLang);
        } catch (error) {
            console.error('Error loading language preference:', error);
            // Default to English if there's an error
            await switchLanguage('en');
        }
    }

    async function switchLanguage(lang) {
        try {
            // Update button states
            if (lang === 'en') {
                langEnBtn.classList.add('active');
                langTrBtn.classList.remove('active');
            } else {
                langTrBtn.classList.add('active');
                langEnBtn.classList.remove('active');
            }

            // Update all elements with data attributes
            const elements = document.querySelectorAll('[data-tr][data-en]');
            elements.forEach(element => {
                const text = element.getAttribute(`data-${lang}`);
                if (text) {
                    element.textContent = text;
                }
            });

            // Update title attributes
            const titleElements = document.querySelectorAll('[data-tr-title][data-en-title]');
            titleElements.forEach(element => {
                const title = element.getAttribute(`data-${lang}-title`);
                if (title) {
                    element.title = title;
                }
            });

            // Update document title
            const titleElement = document.querySelector('title');
            if (titleElement) {
                titleElement.textContent = lang === 'en' ? 'Discord Translator - Settings' : 'Discord Translator - Ayarlar';
            }

            // Update HTML lang attribute
            document.documentElement.lang = lang;

            // Save language preference
            localStorage.setItem('discord-translator-language', lang);

            console.log(`Language switched to: ${lang}`);
        } catch (error) {
            console.error('Error switching language:', error);
        }
    }

    // Shortcut recording functions
    function startShortcutRecording() {
        isRecordingShortcut = true;
        shortcutElements.display.style.display = 'none';
        shortcutElements.recorder.style.display = 'block';
        
        // Update recorder text based on language
        const currentLang = localStorage.getItem('discord-translator-language') || 'en';
        const recorderText = shortcutElements.recorder.querySelector('.recorder-text');
        recorderText.textContent = currentLang === 'tr' ? 'Yeni kısayolu basın...' : 'Press new shortcut...';
        
        console.log('Started shortcut recording');
    }

    function cancelShortcutRecording() {
        isRecordingShortcut = false;
        shortcutElements.recorder.style.display = 'none';
        shortcutElements.display.style.display = 'flex';
        console.log('Cancelled shortcut recording');
    }

    function resetShortcutToDefault() {
        const defaultShortcut = {
            ctrl: true,
            shift: false,
            alt: false,
            key: 'i'
        };
        
        currentShortcut = defaultShortcut;
        updateShortcutDisplay(defaultShortcut);
        cancelShortcutRecording();
        console.log('Reset shortcut to default');
    }

    function handleShortcutRecording(event) {
        if (!isRecordingShortcut) return;

        // Only ignore pure modifier keys (when pressed alone)
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
            return;
        }

        // Handle Escape to cancel
        if (event.key === 'Escape') {
            cancelShortcutRecording();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        // Create shortcut object for any key
        const newShortcut = {
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
            key: event.key
        };

        // Check for conflicts with critical browser shortcuts only
        if (isCriticalConflict(newShortcut)) {
            showShortcutConflictWarning(newShortcut);
            return;
        }

        currentShortcut = newShortcut;
        updateShortcutDisplay(newShortcut);
        cancelShortcutRecording();
        
        console.log('New shortcut recorded:', newShortcut);
    }

    function isCriticalConflict(shortcut) {
        // Only check for absolutely critical browser shortcuts that would break user experience
        const criticalConflicts = [
            { ctrl: true, shift: false, alt: false, key: 'w' }, // Close tab - very dangerous
            { ctrl: true, shift: true, alt: false, key: 'w' },  // Close window - very dangerous
        ];

        return criticalConflicts.some(conflict => 
            conflict.ctrl === shortcut.ctrl &&
            conflict.shift === shortcut.shift &&
            conflict.alt === shortcut.alt &&
            conflict.key === shortcut.key
        );
    }

    function showShortcutConflictWarning(shortcut) {
        const currentLang = localStorage.getItem('discord-translator-language') || 'en';
        const shortcutText = getShortcutText(shortcut);
        
        const message = currentLang === 'tr' 
            ? `${shortcutText} kısayolu tarayıcı ile çakışıyor. Lütfen farklı bir kısayol seçin.`
            : `${shortcutText} conflicts with browser shortcuts. Please choose a different shortcut.`;
            
        showStatus(message, 'error', 4000);
    }

    function updateShortcutDisplay(shortcut) {
        const shortcutText = getShortcutText(shortcut);
        shortcutElements.text.textContent = shortcutText;
    }

    function getShortcutText(shortcut) {
        if (!shortcut) return 'Ctrl + I';
        
        let parts = [];
        if (shortcut.ctrl) parts.push('Ctrl');
        if (shortcut.shift) parts.push('Shift');
        if (shortcut.alt) parts.push('Alt');
        
        if (shortcut.key) {
            // Handle special keys display
            let keyDisplay = shortcut.key;
            if (shortcut.key.startsWith('F') && /^F\d+$/.test(shortcut.key)) {
                keyDisplay = shortcut.key; // F1, F2, F11, F12, etc.
            } else if (shortcut.key === ' ') {
                keyDisplay = 'Space';
            } else if (shortcut.key.length === 1) {
                keyDisplay = shortcut.key.toUpperCase();
            }
            parts.push(keyDisplay);
        }
        
        return parts.length > 1 ? parts.join(' + ') : parts[0] || 'Unknown';
    }

    // Function to fix flag emojis on Windows with colorful alternatives
    function fixWindowsFlagEmojis() {
        // Always apply fixes since Windows flag emojis are problematic
        console.log('Applying flag emoji fixes for better compatibility...');
        
        // Create colorful flag representations using Unicode symbols and colors
        const flagReplacements = {
            '🇹🇷': '<span style="color: #E30A13; font-weight: bold;">🟥</span> TR',
            '🇺🇸': '<span style="color: #B22234; font-weight: bold;">🟦</span> US', 
            '🇪🇸': '<span style="color: #FFC400; font-weight: bold;">🟨</span> ES',
            '🇫🇷': '<span style="color: #002395; font-weight: bold;">🟦</span> FR',
            '🇩🇪': '<span style="color: #FFCE00; font-weight: bold;">🟨</span> DE',
            '🇮🇹': '<span style="color: #009246; font-weight: bold;">🟩</span> IT',
            '🇵🇹': '<span style="color: #006600; font-weight: bold;">🟩</span> PT',
            '🇷🇺': '<span style="color: #0042A5; font-weight: bold;">🟦</span> RU',
            '🇯🇵': '<span style="color: #BC002D; font-weight: bold;">🔴</span> JP',
            '🇰🇷': '<span style="color: #CD212A; font-weight: bold;">⚪</span> KR',
            '🇨🇳': '<span style="color: #DE2910; font-weight: bold;">🟥</span> CN',
            '🇸🇦': '<span style="color: #00703C; font-weight: bold;">🟩</span> SA'
        };
        
        // Replace emojis in select options with text alternatives
        const selectElements = document.querySelectorAll('select option');
        selectElements.forEach(option => {
            let text = option.textContent;
            Object.keys(flagReplacements).forEach(emoji => {
                if (text.includes(emoji)) {
                    // For select options, use simple text without HTML
                    const countryCode = flagReplacements[emoji].split(' ')[1];
                    const colorEmoji = flagReplacements[emoji].includes('🟥') ? '🔴' :
                                     flagReplacements[emoji].includes('🟦') ? '🔵' :
                                     flagReplacements[emoji].includes('🟨') ? '🟡' :
                                     flagReplacements[emoji].includes('🟩') ? '🟢' :
                                     flagReplacements[emoji].includes('⚪') ? '⚪' : '🔴';
                    text = text.replace(emoji, colorEmoji + ' ' + countryCode);
                }
            });
            option.textContent = text;
        });
        
        // Replace emojis in language buttons with HTML
        const langButtons = document.querySelectorAll('.lang-btn');
        langButtons.forEach(button => {
            let html = button.innerHTML;
            Object.keys(flagReplacements).forEach(emoji => {
                if (html.includes(emoji)) {
                    html = html.replace(emoji, flagReplacements[emoji]);
                }
            });
            button.innerHTML = html;
        });
        
        console.log('Flag emoji fixes applied with colorful alternatives');
    }

    // Function to setup flag icons for select elements
    function setupSelectFlagIcons() {
        const selects = document.querySelectorAll('.modern-select');
        
        selects.forEach(select => {
            const wrapper = select.parentElement;
            
            // Function to update flag icon based on selected value
            function updateFlagIcon() {
                const selectedValue = select.value;
                wrapper.setAttribute('data-selected', selectedValue);
                console.log('Flag icon updated for:', selectedValue);
            }
            
            // Set initial flag icon
            updateFlagIcon();
            
            // Update flag icon when selection changes
            select.addEventListener('change', updateFlagIcon);
        });
        
        console.log('Flag icons setup completed for select elements');
    }

    // Function to setup custom dropdowns with flag icons
    function setupCustomDropdowns() {
        const customSelects = document.querySelectorAll('.custom-select');
        
        customSelects.forEach(customSelect => {
            const trigger = customSelect.querySelector('.custom-select-trigger');
            const options = customSelect.querySelectorAll('.custom-option');
            const wrapper = customSelect.closest('.custom-select-wrapper');
            const hiddenInput = wrapper.querySelector('input[type="hidden"]');
            
            // Toggle dropdown
            trigger.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Close other dropdowns
                document.querySelectorAll('.custom-select.open').forEach(otherSelect => {
                    if (otherSelect !== customSelect) {
                        otherSelect.classList.remove('open', 'open-upward', 'open-downward');
                    }
                });
                
                // Toggle this dropdown
                if (customSelect.classList.contains('open')) {
                    customSelect.classList.remove('open', 'open-upward', 'open-downward');
                } else {
                    // Determine if dropdown should open upward or downward
                    const rect = trigger.getBoundingClientRect();
                    const windowHeight = window.innerHeight;
                    const dropdownHeight = 180; // max-height from CSS
                    const spaceBelow = windowHeight - rect.bottom;
                    const spaceAbove = rect.top;
                    
                    console.log('=== DROPDOWN DIRECTION CALCULATION ===');
                    console.log('Window height:', windowHeight);
                    console.log('Trigger position - top:', rect.top, 'bottom:', rect.bottom);
                    console.log('Space below:', spaceBelow);
                    console.log('Space above:', spaceAbove);
                    console.log('Required space:', dropdownHeight);
                    
                    // TEST: Her zaman yukarıya aç
                    customSelect.classList.add('open', 'open-upward');
                    console.log('✅ FORCING dropdown UPWARD for testing');
                    console.log('Classes added:', customSelect.className);
                    
                    // Eski kod (test için yorumlandı):
                    // if (spaceBelow < 150) {
                    //     customSelect.classList.add('open', 'open-upward');
                    // } else {
                    //     customSelect.classList.add('open', 'open-downward');
                    // }
                }
            });
            
            // Handle option selection
            options.forEach(option => {
                option.addEventListener('click', function(e) {
                    e.preventDefault();
                    
                    const value = this.getAttribute('data-value');
                    const flagIcon = this.querySelector('.flag-icon');
                    const text = this.querySelector('span:last-child').textContent;
                    
                    // Update trigger display
                    const triggerFlag = trigger.querySelector('.flag-icon');
                    const triggerText = trigger.querySelector('.select-text');
                    
                    triggerFlag.className = flagIcon.className;
                    triggerText.textContent = text;
                    
                    // Update hidden input
                    hiddenInput.value = value;
                    customSelect.setAttribute('data-value', value);
                    
                    // Update selected state
                    options.forEach(opt => opt.classList.remove('selected'));
                    this.classList.add('selected');
                    
                    // Close dropdown
                    customSelect.classList.remove('open', 'open-upward', 'open-downward');
                    
                    // Trigger change event for form validation
                    const changeEvent = new Event('change', { bubbles: true });
                    hiddenInput.dispatchEvent(changeEvent);
                    
                    console.log('Custom dropdown value changed:', value);
                });
            });
        });
        
        // Close dropdowns when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.custom-select')) {
                document.querySelectorAll('.custom-select.open').forEach(select => {
                    select.classList.remove('open', 'open-upward', 'open-downward');
                });
            }
        });
        
        console.log('Custom dropdowns setup completed');
    }

    // Helper functions for custom dropdowns
    function setCustomDropdownValue(name, value) {
        const wrapper = document.querySelector(`[data-name="${name}"]`);
        if (!wrapper) return;
        
        const customSelect = wrapper.querySelector('.custom-select');
        const hiddenInput = wrapper.querySelector('input[type="hidden"]');
        const trigger = wrapper.querySelector('.custom-select-trigger');
        const option = wrapper.querySelector(`[data-value="${value}"]`);
        
        if (option) {
            const flagIcon = option.querySelector('.flag-icon');
            const text = option.querySelector('span:last-child').textContent;
            
            // Update trigger display
            const triggerFlag = trigger.querySelector('.flag-icon');
            const triggerText = trigger.querySelector('.select-text');
            
            triggerFlag.className = flagIcon.className;
            triggerText.textContent = text;
            
            // Update hidden input and custom select
            hiddenInput.value = value;
            customSelect.setAttribute('data-value', value);
            
            // Update selected state
            wrapper.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
        }
    }
    
    function getCustomDropdownValue(name) {
        const hiddenInput = document.querySelector(`[data-name="${name}"] input[type="hidden"]`);
        return hiddenInput ? hiddenInput.value : '';
    }
});