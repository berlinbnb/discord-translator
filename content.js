// Discord Translator Extension - Content Script

console.log('Discord Translator Extension content script loaded');

// Debug mode flag
const DEBUG_MODE = true;

// Debug logging helper
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[Discord Translator]', ...args);
  }
}

// Main class for Discord translation functionality
class DiscordTranslator {
  constructor() {
    this.settings = null;
    this.observer = null;
    this.isInitialized = false;
    this.currentLoadingNotification = null;
    this.lastKnownLanguage = localStorage.getItem('discord-translator-language') || 'en';

    this.init();
  }

  async init() {
    try {
      debugLog('=== DISCORD TRANSLATOR INIT STARTED ===');
      
      // Load settings from background
      debugLog('Loading settings from background...');
      await this.loadSettings();
      debugLog('Settings loaded:', this.settings);

      // Wait for Discord to load
      debugLog('About to call waitForDiscord()');
      this.waitForDiscord();
      debugLog('waitForDiscord() called');
      
      // Update button texts on initialization
      setTimeout(() => {
        this.updateTranslateButtonTexts();
      }, 2000);

    } catch (error) {
      console.error('Error initializing Discord Translator:', error);
    }
  }

  async loadSettings() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        this.settings = response.settings;
        debugLog('Settings loaded:', this.settings);
        resolve();
      });
    });
  }

  async reloadSettings() {
    try {
      await this.loadSettings();
      debugLog('Settings reloaded:', this.settings);

      // If translation mode changed, we might need to update existing messages
      this.handleSettingsChange();
    } catch (error) {
      console.error('Error reloading settings:', error);
    }
  }

  handleSettingsChange() {
    // Clear any existing auto-translation processing flags if mode changed to non-auto
    if (this.settings.readingMode !== 'auto') {
      const processedMessages = document.querySelectorAll('[data-translator-auto-processed="true"]');
      processedMessages.forEach(msg => {
        delete msg.dataset.translatorAutoProcessed;
      });
    }

    // Restore any translated messages to original text when switching modes - no visual cleanup needed
    const translatedMessages = document.querySelectorAll('[data-translator-translated="true"]');
    translatedMessages.forEach(messageContent => {
      if (messageContent.dataset.originalText) {
        messageContent.textContent = messageContent.dataset.originalText;
        delete messageContent.dataset.translatorTranslated;
        delete messageContent.dataset.sourceLang;
        delete messageContent.dataset.targetLang;
      }
    });

    // Clean up click translation setup if mode changed from click
    if (this.settings.readingMode !== 'click') {
      this.cleanupClickTranslation();
    }

    // Remove any existing overlays when settings change
    const existingOverlays = document.querySelectorAll('.discord-translator-overlay');
    existingOverlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    // If switched to auto mode, process existing messages
    if (this.settings.readingMode === 'auto') {
      setTimeout(() => {
        this.processExistingMessages();
      }, 500);
    }

    // If switched to click mode, setup click handlers for existing messages
    if (this.settings.readingMode === 'click') {
      setTimeout(() => {
        this.setupClickTranslationForExistingMessages();
      }, 500);
    }
  }

  waitForDiscord() {
    // Check if Discord main container is loaded
    const checkDiscord = () => {
      debugLog('Checking for Discord app...');
      
      const discordApp = document.querySelector('[class*="app-"]') ||
        document.querySelector('#app-mount') ||
        document.querySelector('[class*="appMount-"]') ||
        document.querySelector('body') ||
        document.documentElement;

      if (discordApp) {
        debugLog('Discord app detected, starting translator');
        this.startTranslator();
      } else {
        debugLog('Discord app not found, retrying in 1 second...');
        // Retry after 1 second
        setTimeout(checkDiscord, 1000);
      }
    };

    checkDiscord();
  }

  startTranslator() {
    if (this.isInitialized) return;

    debugLog('Starting Discord Translator with settings:', this.settings);

    // Start observing Discord messages
    this.observeMessages();

    // Setup keyboard shortcuts for writing translation
    debugLog('About to call setupKeyboardShortcuts()');
    this.setupKeyboardShortcuts();
    debugLog('setupKeyboardShortcuts() completed');

    // Handle Discord's SPA navigation
    this.handleDiscordNavigation();

    // Setup global message event handler
    this.messageEventHandler = (event) => {
      debugLog('Global message event received:', event.detail);
    };
    document.addEventListener('discordMessageDetected', this.messageEventHandler);

    // Listen for settings changes
    this.setupSettingsListener();

    this.isInitialized = true;
  }

  observeMessages() {
    debugLog('Message observation started');

    // Discord message selectors - updated based on real Discord HTML structure
    this.messageSelectors = {
      // Main message list items (the actual li elements that contain messages)
      messageListItem: [
        'li[class*="messageListItem"]',
        'li[id^="chat-messages-"]'
      ],
      // Message containers (the div elements inside li that contain the actual message)
      messageContainer: [
        '[class*="message"][class*="cozy"]',
        '[class*="message"][class*="groupStart"]',
        '[class*="message"][role="article"]',
        'div[class*="message__"]'
      ],
      // Message content selectors (the actual text content)
      messageContent: [
        '[id^="message-content-"][class*="markup"]',
        '[class*="messageContent"]',
        '[class*="markup__"]'
      ],
      // Username selectors
      username: [
        '[class*="username"]',
        '[id^="message-username-"]'
      ],
      // Timestamp selectors
      timestamp: [
        'time[datetime]',
        '[id^="message-timestamp-"]'
      ],
      // Messages list container (the scrollable container that holds all messages)
      messagesContainer: [
        '[class*="messages"]',
        '[class*="messagesWrapper"]',
        '[class*="chatContent"]',
        '[data-list-id="chat-messages"]',
        '[class*="scrollerInner"]',
        'ol[data-list-id="chat-messages"]'
      ]
    };

    // Create mutation observer to watch for new messages
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.processNewElements(node);
            }
          });
        }
      });
    });

    // Find and observe the Discord messages container
    const messagesContainer = this.findDiscordMessagesContainer();

    if (messagesContainer) {
      debugLog('Found Discord messages container, starting observation');
      this.observer.observe(messagesContainer, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
      });

      // Also process existing messages on page load
      this.processExistingMessages();
    } else {
      debugLog('Discord messages container not found, retrying in 2 seconds');
      setTimeout(() => this.observeMessages(), 2000);
    }
  }

  findDiscordMessagesContainer() {
    // Try to find the messages container using multiple selectors
    for (const selector of this.messageSelectors.messagesContainer) {
      const container = document.querySelector(selector);
      if (container) {
        debugLog('Found messages container with selector:', selector);
        return container;
      }
    }

    // Fallback: look for any element that contains message-like elements
    const messageElements = document.querySelectorAll('[class*="message"]');
    if (messageElements.length > 0) {
      // Find common parent container
      let commonParent = messageElements[0].parentElement;
      while (commonParent && commonParent !== document.body) {
        const childMessages = commonParent.querySelectorAll('[class*="message"]');
        if (childMessages.length >= messageElements.length * 0.8) {
          debugLog('Found messages container via common parent');
          return commonParent;
        }
        commonParent = commonParent.parentElement;
      }
    }

    return null;
  }

  processExistingMessages() {
    // Process messages that are already on the page
    const existingMessages = this.findAllMessageElements();
    debugLog(`Processing ${existingMessages.length} existing messages`);

    existingMessages.forEach(messageEl => {
      if (!messageEl.dataset.translatorProcessed) {
        this.triggerMessageEvent(messageEl, 'existing');
      }
    });
  }

  findAllMessageElements() {
    const messages = [];

    // First try to find message list items (li elements)
    for (const selector of this.messageSelectors.messageListItem) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (!messages.includes(el)) {
          messages.push(el);
        }
      });
    }

    // If no list items found, try message containers directly
    if (messages.length === 0) {
      for (const selector of this.messageSelectors.messageContainer) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!messages.includes(el)) {
            messages.push(el);
          }
        });
      }
    }

    return messages.filter(el => this.isValidMessageElement(el));
  }

  isValidMessageElement(element) {
    // Check if element contains actual message content
    const hasContent = this.messageSelectors.messageContent.some(selector =>
      element.querySelector(selector)
    );

    // Check if it's not a system message or empty
    const textContent = element.textContent?.trim();
    const isNotEmpty = textContent && textContent.length > 0;

    // Avoid processing the same element multiple times
    const notProcessed = !element.dataset.translatorProcessed;

    return hasContent && isNotEmpty && notProcessed;
  }

  processNewElements(element) {
    // Find message elements within the new element
    const messageElements = [];

    // Check if the element itself is a message list item or message container
    if (this.isValidMessageElement(element)) {
      messageElements.push(element);
    }

    // First try to find message list items (li elements)
    for (const selector of this.messageSelectors.messageListItem) {
      const foundMessages = element.querySelectorAll(selector);
      foundMessages.forEach(msg => {
        if (this.isValidMessageElement(msg) && !messageElements.includes(msg)) {
          messageElements.push(msg);
        }
      });
    }

    // Then try message containers within the element
    for (const selector of this.messageSelectors.messageContainer) {
      const foundMessages = element.querySelectorAll(selector);
      foundMessages.forEach(msg => {
        if (this.isValidMessageElement(msg) && !messageElements.includes(msg)) {
          messageElements.push(msg);
        }
      });
    }

    // Process each found message
    messageElements.forEach(messageEl => {
      this.triggerMessageEvent(messageEl, 'new');
    });
  }

  triggerMessageEvent(messageElement, eventType = 'new') {
    // Mark as processed to avoid duplicate processing
    messageElement.dataset.translatorProcessed = 'true';

    // Extract message content
    const messageData = this.extractMessageData(messageElement);

    if (messageData && messageData.text) {
      debugLog(`${eventType} message detected:`, messageData);

      // Trigger custom event for message detection
      const messageEvent = new CustomEvent('discordMessageDetected', {
        detail: {
          element: messageElement,
          data: messageData,
          type: eventType,
          timestamp: Date.now()
        }
      });

      document.dispatchEvent(messageEvent);

      // Process based on current settings
      this.handleDetectedMessage(messageElement, messageData, eventType);
    }
  }

  extractMessageData(messageElement) {
    // Find the MAIN message text content (not reply preview)
    let textElement = null;
    let messageText = '';

    // First try to find the main message content by ID (excluding reply content)
    textElement = messageElement.querySelector('[id^="message-content-"]:not([class*="repliedTextContent"])');
    if (textElement) {
      messageText = textElement.textContent?.trim();
    }

    // If not found, look for message content that's NOT inside a reply preview
    if (!messageText) {
      for (const selector of this.messageSelectors.messageContent) {
        const elements = messageElement.querySelectorAll(selector);
        for (const element of elements) {
          // Skip if this content is inside a reply preview
          if (!element.closest('[class*="repliedTextPreview"], [class*="repliedMessage"]')) {
            textElement = element;
            messageText = element.textContent?.trim();
            if (messageText) break;
          }
        }
        if (messageText) break;
      }
    }

    // Fallback: get text from the message element itself, but exclude buttons and other UI elements
    if (!messageText) {
      // Clone the element to avoid modifying the original
      const clone = messageElement.cloneNode(true);

      // Remove button containers and other UI elements that shouldn't be translated
      const elementsToRemove = clone.querySelectorAll(
        '[class*="buttonContainer"], [class*="buttons"], [class*="hoverBar"], [class*="embedFull"], [class*="embed"]'
      );
      elementsToRemove.forEach(el => el.remove());

      messageText = clone.textContent?.trim();
    }

    if (!messageText) return null;

    // Extract message ID from the element or its parent
    let messageId = messageElement.id;
    if (!messageId && messageElement.parentElement) {
      messageId = messageElement.parentElement.id;
    }
    if (!messageId) {
      // Extract from message content ID if available
      const contentElement = messageElement.querySelector('[id^="message-content-"]');
      if (contentElement) {
        messageId = contentElement.id.replace('message-content-', '');
      }
    }
    if (!messageId) {
      messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    // Try to find author information using updated selectors
    let authorElement = null;
    for (const selector of this.messageSelectors.username) {
      authorElement = messageElement.querySelector(selector);
      if (authorElement) break;
    }
    const author = authorElement?.textContent?.trim() || 'Unknown';

    // Try to find timestamp using updated selectors
    let timestampElement = null;
    for (const selector of this.messageSelectors.timestamp) {
      timestampElement = messageElement.querySelector(selector);
      if (timestampElement) break;
    }

    const timestamp = timestampElement?.getAttribute('datetime') ||
      timestampElement?.textContent ||
      new Date().toISOString();

    return {
      id: messageId,
      text: messageText,
      author: author,
      timestamp: timestamp,
      element: messageElement,
      textElement: textElement
    };
  }

  handleDetectedMessage(messageElement, messageData, eventType) {
    // Handle message based on current translation settings
    if (!this.settings) {
      console.warn('Settings not loaded, skipping message processing');
      return;
    }

    debugLog('Handling detected message with mode:', this.settings.readingMode);

    // Skip if message is too short or looks like a command
    if (messageData.text.length < 2 || messageData.text.startsWith('/')) {
      debugLog('Skipping message - too short or command:', messageData.text);
      return;
    }

    // Process based on reading mode
    switch (this.settings.readingMode) {
      case 'auto':
        debugLog('Processing in auto mode');
        // Auto translation mode - implement automatic translation
        this.handleAutoTranslation(messageElement, messageData);
        break;

      case 'click':
        debugLog('Processing in click mode');
        // Click translation mode - setup click handlers
        this.setupClickTranslation(messageElement, messageData);
        break;

      default:
        debugLog('Translation disabled or unknown mode:', this.settings.readingMode);
    }
  }

  async handleAutoTranslation(messageElement, messageData) {
    try {
      debugLog('Processing auto translation for message:', messageData.id);

      // Check if already translated
      if (messageElement.dataset.translatorAutoProcessed) {
        debugLog('Message already auto-translated, skipping');
        return;
      }

      // Mark as being processed
      messageElement.dataset.translatorAutoProcessed = 'true';

      // Handle multiple message contents in reply containers
      await this.handleAutoTranslationForAllContents(messageElement, messageData);

    } catch (error) {
      console.error('Error in auto translation:', error);
    }
  }

  async handleAutoTranslationForAllContents(messageElement, messageData) {
    // Find all message contents in this container
    const messageContents = this.findAllMessageContents(messageElement);

    debugLog(`Processing auto translation for ${messageContents.length} contents`);

    for (const [index, contentInfo] of messageContents.entries()) {
      const { element: contentElement, text: contentText, type } = contentInfo;

      if (contentText && contentText.length > 2 && !contentText.startsWith('/')) {
        // Create unique message data for each content
        const contentMessageData = {
          ...messageData,
          id: `${messageData.id}_${type}_${index}`,
          text: contentText,
          textElement: contentElement,
          type: type
        };

        debugLog(`Processing auto translation for ${type} content:`, contentMessageData.id);
        await this.processAutoTranslationForContent(messageElement, contentMessageData, contentElement);
      }
    }
  }

  async processAutoTranslationForContent(messageElement, messageData, contentElement) {
    try {
      // Check if already translated
      if (contentElement.dataset.translatorTranslated) {
        debugLog('Content already translated, skipping:', messageData.id);
        return;
      }

      // Store original text
      if (!contentElement.dataset.originalText) {
        contentElement.dataset.originalText = messageData.text;
      }

      // Request translation from background script
      const translationResult = await this.requestTranslation(
        messageData.text,
        this.settings.readingTargetLang
      );

      if (translationResult.success) {
        if (translationResult.skipped) {
          // Translation was skipped (same language, etc.)
          debugLog('Translation skipped for content:', translationResult.reason);
        } else {
          // Replace message text with translation - no visual changes
          contentElement.textContent = translationResult.translatedText;
          contentElement.dataset.translatorTranslated = 'true';
          contentElement.dataset.sourceLang = translationResult.sourceLang;
          contentElement.dataset.targetLang = translationResult.targetLang;

          debugLog('Message text replaced with translation:', messageData.id);
        }
      } else {
        // Show error in console only, don't modify the message
        console.error('Translation error for message:', messageData.id, translationResult.error);
      }

    } catch (error) {
      console.error('Error in auto translation for content:', error);
    }
  }



  async requestTranslation(text, targetLang, sourceLang = 'auto') {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        targetLang: targetLang,
        sourceLang: sourceLang,
        checkIfNeeded: true // Enable language detection optimization
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response) {
          reject(new Error('No response from background script'));
          return;
        }

        resolve(response);
      });
    });
  }

  getLanguageName(langCode) {
    const languageNames = {
      'tr': 'Türkçe',
      'en': 'English',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'it': 'Italiano',
      'pt': 'Português',
      'ru': 'Русский',
      'ja': '日本語',
      'ko': '한국어',
      'zh': '中文',
      'ar': 'العربية',
      'auto': 'Otomatik'
    };

    return languageNames[langCode] || langCode.toUpperCase();
  }

  setupSettingsListener() {
    // Listen for storage changes to update settings in real-time
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        debugLog('Settings changed, reloading...');
        this.reloadSettings();
      }
    });

    // Also listen for messages from options page
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'settingsUpdated') {
        debugLog('Settings updated message received');
        this.reloadSettings();
      }
    });
  }

  setupClickTranslation(messageElement, messageData) {
    debugLog('Setting up click translation for message:', messageData.id);

    // Add translation link for click-to-translate mode
    if (!messageElement.dataset.clickTranslationSetup) {
      messageElement.dataset.clickTranslationSetup = 'true';

      // Handle multiple message contents in reply containers
      this.setupClickTranslationForAllContents(messageElement, messageData);
    } else {
      debugLog('Click translation already setup for message:', messageData.id);
    }
  }

  setupClickTranslationForAllContents(messageElement, messageData) {
    // Find all message contents in this container (both reply preview and main message)
    const messageContents = this.findAllMessageContents(messageElement);

    debugLog(`Found ${messageContents.length} message contents in container`);

    messageContents.forEach((contentInfo, index) => {
      const { element: contentElement, text: contentText, type } = contentInfo;

      if (contentText && contentText.length > 2 && !contentText.startsWith('/')) {
        // Create unique message data for each content
        const contentMessageData = {
          ...messageData,
          id: `${messageData.id}_${type}_${index}`,
          text: contentText,
          textElement: contentElement,
          type: type // 'main' or 'reply'
        };

        debugLog(`Adding translation link for ${type} content:`, contentMessageData.id);
        this.addTranslationLink(messageElement, contentMessageData, contentElement);
      }
    });
  }

  findAllMessageContents(messageElement) {
    const contents = [];

    // 1. Find reply preview content (if exists)
    const replyContent = messageElement.querySelector('[class*="repliedTextContent"]');
    if (replyContent) {
      const replyText = replyContent.textContent?.trim();
      if (replyText) {
        contents.push({
          element: replyContent,
          text: replyText,
          type: 'reply'
        });
      }
    }

    // 2. Find main message content
    const mainContent = messageElement.querySelector('[id^="message-content-"]:not([class*="repliedTextContent"])');
    if (mainContent) {
      const mainText = mainContent.textContent?.trim();
      if (mainText) {
        contents.push({
          element: mainContent,
          text: mainText,
          type: 'main'
        });
      }
    }

    // 3. Fallback: find any other message contents not in reply preview
    if (contents.length === 0) {
      const allContents = messageElement.querySelectorAll('[class*="messageContent"], [class*="markup"]');
      allContents.forEach((content, index) => {
        const text = content.textContent?.trim();
        if (text) {
          const isInReply = content.closest('[class*="repliedTextPreview"], [class*="repliedMessage"]');
          contents.push({
            element: content,
            text: text,
            type: isInReply ? 'reply' : 'main'
          });
        }
      });
    }

    return contents;
  }

  addTranslationLink(messageElement, messageData, specificContentElement = null) {
    try {
      // Use the specific content element if provided, otherwise find it
      let messageContent = specificContentElement;

      if (!messageContent) {
        // Fallback to old logic for backward compatibility
        messageContent = messageElement.querySelector('[id^="message-content-"]:not([class*="repliedTextContent"])');

        if (!messageContent) {
          const allMessageContents = messageElement.querySelectorAll('[class*="messageContent"], [class*="markup"]');
          for (const content of allMessageContents) {
            if (!content.closest('[class*="repliedTextPreview"], [class*="repliedMessage"]')) {
              messageContent = content;
              break;
            }
          }
        }
      }

      if (!messageContent) {
        debugLog('Could not find message content area for translation button');
        return;
      }

      // Check if this specific content already has a translation button
      const existingButton = messageContent.parentElement?.querySelector(`[data-message-id="${messageData.id}"]`);
      if (existingButton) {
        debugLog('Translation button already exists for this content:', messageData.id);
        return;
      }

      debugLog('Adding translation button for content:', messageContent.className, 'Type:', messageData.type);

      // Store original text if not already stored
      if (!messageContent.dataset.originalText) {
        messageContent.dataset.originalText = messageData.text;
      }

      // Create translation button
      const translateButton = document.createElement('button');
      translateButton.className = 'discord-translator-button';
      translateButton.dataset.messageId = messageData.id;

      // Button styling - more prominent and visible
      translateButton.style.cssText = `
        margin-top: 8px;
        margin-bottom: 4px;
        padding: 6px 12px;
        font-size: 14px;
        color: #ffffff;
        background: #4752c4;
        border: 2px solid #4752c4;
        border-radius: 8px;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(71, 82, 196, 0.3);
        min-width: 60px;
        width: 60px;
        height: 28px;
        justify-content: center;
      `;

      // Add button with icon only (global compatibility)
      const buttonText = messageData.type === 'reply' ? '🌐' : '🌐';
      translateButton.innerHTML = buttonText;

      // Add enhanced hover effects
      translateButton.addEventListener('mouseenter', () => {
        const currentBg = translateButton.style.background;
        if (currentBg.includes('43b581')) {
          // Green button (Orijinali Göster)
          translateButton.style.background = '#3a9b6f';
          translateButton.style.borderColor = '#3a9b6f';
          translateButton.style.transform = 'translateY(-2px) scale(1.05)';
          translateButton.style.boxShadow = '0 4px 16px rgba(67, 181, 129, 0.5)';
        } else {
          // Blue button (Mesajı Çevir)
          translateButton.style.background = '#3c4aa0';
          translateButton.style.borderColor = '#3c4aa0';
          translateButton.style.transform = 'translateY(-2px) scale(1.05)';
          translateButton.style.boxShadow = '0 4px 16px rgba(71, 82, 196, 0.5)';
        }
      });

      translateButton.addEventListener('mouseleave', () => {
        const currentBg = translateButton.style.background;
        if (currentBg.includes('3a9b6f')) {
          // Green button (Orijinali Göster)
          translateButton.style.background = '#43b581';
          translateButton.style.borderColor = '#43b581';
          translateButton.style.transform = 'translateY(0) scale(1)';
          translateButton.style.boxShadow = '0 2px 8px rgba(67, 181, 129, 0.3)';
        } else {
          // Blue button (Mesajı Çevir)
          translateButton.style.background = '#4752c4';
          translateButton.style.borderColor = '#4752c4';
          translateButton.style.transform = 'translateY(0) scale(1)';
          translateButton.style.boxShadow = '0 2px 8px rgba(71, 82, 196, 0.3)';
        }
      });

      // Add click handler to replace message text
      translateButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();
        debugLog('Translation button clicked for message:', messageData.id);

        // Check if already translated
        if (messageContent.dataset.translatorTranslated === 'true') {
          // Restore original text - no visual changes
          messageContent.textContent = messageContent.dataset.originalText;
          messageContent.dataset.translatorTranslated = 'false';
          translateButton.innerHTML = buttonText;
          translateButton.style.background = '#4752c4';
          debugLog('Restored original text for message:', messageData.id);
          return;
        }

        // Show loading state
        const originalButtonText = translateButton.innerHTML;
        translateButton.innerHTML = '🔄';
        translateButton.style.background = '#72767d';
        translateButton.disabled = true;

        try {
          // Request translation
          const translationResult = await this.requestTranslation(
            messageData.text,
            this.settings.readingTargetLang
          );

          if (translationResult.success) {
            if (translationResult.skipped) {
              // Translation was skipped
              debugLog('Translation skipped for content:', translationResult.reason);
              translateButton.innerHTML = '✓ Aynı dil';
              translateButton.style.background = '#43b581';
              setTimeout(() => {
                translateButton.innerHTML = originalButtonText;
                translateButton.style.background = '#4752c4';
                translateButton.disabled = false;
              }, 2000);
            } else {
              // Replace message text with translation - no visual changes
              messageContent.textContent = translationResult.translatedText;
              messageContent.dataset.translatorTranslated = 'true';
              messageContent.dataset.sourceLang = translationResult.sourceLang;
              messageContent.dataset.targetLang = translationResult.targetLang;

              // Update button to show restore option with enhanced styling (icon only)
              translateButton.innerHTML = '↩️';
              translateButton.style.background = '#43b581';
              translateButton.style.borderColor = '#43b581';
              translateButton.style.boxShadow = '0 2px 8px rgba(67, 181, 129, 0.3)';
              translateButton.disabled = false;

              debugLog('Message text replaced with translation:', messageData.id);
            }
          } else {
            // Show error
            translateButton.innerHTML = '❌ Hata';
            translateButton.style.background = '#ed4245';
            setTimeout(() => {
              translateButton.innerHTML = originalButtonText;
              translateButton.style.background = '#4752c4';
              translateButton.disabled = false;
            }, 3000);
          }
        } catch (error) {
          console.error('Error in click translation:', error);
          translateButton.innerHTML = '❌ Hata';
          translateButton.style.background = '#ed4245';
          setTimeout(() => {
            translateButton.innerHTML = originalButtonText;
            translateButton.style.background = '#4752c4';
            translateButton.disabled = false;
          }, 3000);
        }
      });

      // Find the best insertion point (below the message content)
      const messageContentContainer = messageContent.closest('[class*="messageContent"]') ||
        messageContent.parentElement;

      if (messageContentContainer) {
        // Insert after the message content container to place it below
        if (messageContentContainer.nextSibling) {
          messageContentContainer.parentNode.insertBefore(translateButton, messageContentContainer.nextSibling);
        } else {
          messageContentContainer.parentNode.appendChild(translateButton);
        }
        debugLog('Translation button inserted after message content container');
      } else {
        // Fallback: append to message element
        messageElement.appendChild(translateButton);
        debugLog('Translation button appended to message element (fallback)');
      }

      debugLog('Translation button added to message:', messageData.id);

    } catch (error) {
      console.error('Error adding translation button:', error);
    }
  }







  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  cleanupClickTranslation() {
    // Remove click translation setup from all messages
    const clickTranslationMessages = document.querySelectorAll('[data-click-translation-setup="true"]');
    clickTranslationMessages.forEach(messageElement => {
      // Remove dataset flag
      delete messageElement.dataset.clickTranslationSetup;
    });

    // Remove all translation buttons
    const translationButtons = document.querySelectorAll('.discord-translator-button');
    translationButtons.forEach(button => {
      if (button.parentNode) {
        button.parentNode.removeChild(button);
      }
    });

    // Restore any translated messages to original text - no visual cleanup needed
    const translatedMessages = document.querySelectorAll('[data-translator-translated="true"]');
    translatedMessages.forEach(messageContent => {
      if (messageContent.dataset.originalText) {
        messageContent.textContent = messageContent.dataset.originalText;
        delete messageContent.dataset.translatorTranslated;
        delete messageContent.dataset.sourceLang;
        delete messageContent.dataset.targetLang;
      }
    });

    // Remove all translation links (legacy cleanup)
    const translationLinks = document.querySelectorAll('.discord-translator-link');
    translationLinks.forEach(link => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    });

    // Remove empty button containers we created (legacy cleanup)
    const buttonContainers = document.querySelectorAll('.discord-translator-button-container');
    buttonContainers.forEach(container => {
      if (container.children.length === 0 && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    debugLog('Click translation cleanup completed');
  }

  setupClickTranslationForExistingMessages() {
    // Setup click translation for messages that are already on the page
    const existingMessages = this.findAllMessageElements();
    debugLog(`Setting up click translation for ${existingMessages.length} existing messages`);

    existingMessages.forEach(messageEl => {
      if (!messageEl.dataset.clickTranslationSetup) {
        const messageData = this.extractMessageData(messageEl);
        if (messageData && messageData.text) {
          this.setupClickTranslation(messageEl, messageData);
        }
      }
    });
  }

  setupKeyboardShortcuts() {
    debugLog('Setting up keyboard shortcuts for writing translation');

    // Discord message input selectors based on provided HTML structure
    this.inputSelectors = {
      // Main text area container
      textAreaContainer: [
        '[class*="textArea"][class*="textAreaSlate"]',
        '[class*="textArea__"]'
      ],
      // The actual editable div (contenteditable)
      editableDiv: [
        '[role="textbox"][contenteditable="true"]',
        '[class*="editor"][class*="slate"]',
        '[data-slate-editor="true"]'
      ],
      // Slate text elements
      slateText: [
        '[data-slate-node="text"]',
        '[data-slate-leaf="true"]'
      ]
    };

    // Enhanced keyboard event listener with custom shortcuts
    document.addEventListener('keydown', (event) => {
      // Check if the pressed key combination matches user's custom shortcut
      if (this.matchesCustomShortcut(event)) {
        // Double-check that we're in a Discord input field to avoid conflicts
        const activeElement = document.activeElement;
        const isInDiscordInput = this.isValidMessageInput(activeElement) || 
                                this.isElementInDiscordTextArea(activeElement);

        if (isInDiscordInput) {
          event.preventDefault();
          event.stopPropagation();

          const shortcutText = this.getShortcutText(this.settings.customShortcut);
          debugLog(`Custom shortcut ${shortcutText} detected in Discord input, attempting message translation`);
          this.handleWritingTranslation();
        } else {
          debugLog('Custom shortcut detected but not in Discord input field, ignoring');
        }
      }
    });

    // Setup translate button in message input area
    debugLog('About to call setupTranslateButton()');
    this.setupTranslateButton();
    debugLog('setupTranslateButton() completed');

    debugLog('Keyboard shortcuts setup completed');
  }

  // Check if current key event matches user's custom shortcut
  matchesCustomShortcut(event) {
    if (!this.settings || !this.settings.customShortcut) {
      // Default fallback shortcut if not set
      return event.ctrlKey && !event.shiftKey && !event.altKey && 
             (event.key === 'i' || event.key === 'I' || event.code === 'KeyI');
    }

    const shortcut = this.settings.customShortcut;
    
    // Check modifier keys
    const modifiersMatch = (
      event.ctrlKey === (shortcut.ctrl || false) &&
      event.shiftKey === (shortcut.shift || false) &&
      event.altKey === (shortcut.alt || false)
    );

    if (!modifiersMatch) return false;

    // Check the main key
    return this.keyMatches(event, shortcut.key);
  }

  // Check if the pressed key matches the target key (with fallbacks for different keyboards)
  keyMatches(event, targetKey) {
    if (!targetKey) return false;
    
    // Direct key match (works for F keys, special keys, etc.)
    if (event.key === targetKey) {
      return true;
    }
    
    // For regular letters, try case-insensitive matching
    if (targetKey.length === 1) {
      const targetKeyLower = targetKey.toLowerCase();
      return (
        event.key === targetKeyLower ||
        event.key === targetKey.toUpperCase() ||
        event.code === `Key${targetKey.toUpperCase()}` ||
        (event.key && event.key.toLowerCase() === targetKeyLower)
      );
    }
    
    // For function keys and special keys, exact match
    return event.key === targetKey;
  }

  // Get human-readable text for shortcut
  getShortcutText(shortcut) {
    if (!shortcut) return 'Ctrl+I';
    
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
    
    return parts.length > 1 ? parts.join('+') : parts[0] || 'Unknown';
  }

  // Check if element is within Discord text area
  isElementInDiscordTextArea(element) {
    if (!element) return false;
    
    // Check if element is within a Discord text area
    const textAreaContainer = element.closest('[class*="textArea"]');
    return textAreaContainer !== null;
  }

  // Setup translate button in Discord message input area
  setupTranslateButton() {
    debugLog('=== SETUP TRANSLATE BUTTON STARTED (SIMPLE METHOD) ===');
    
    // Simple approach: Find the message input area and add button directly
    const addButtonToMessageInput = () => {
      debugLog('Looking for message input area...');
      
      // Find the message input area by looking for the textArea
      const textArea = document.querySelector('[class*="textArea"]');
      if (!textArea) {
        debugLog('TextArea not found, retrying in 2 seconds...');
        setTimeout(addButtonToMessageInput, 2000);
        return;
      }
      
      debugLog('TextArea found:', textArea);
      
      // Find the buttons container
      const buttonsContainer = textArea.closest('[class*="scrollableContainer"]')?.querySelector('[class*="buttons"]');
      if (!buttonsContainer) {
        debugLog('Buttons container not found, retrying in 2 seconds...');
        setTimeout(addButtonToMessageInput, 2000);
        return;
      }
      
      debugLog('Buttons container found:', buttonsContainer);
      
      // Check if translate button already exists
      if (buttonsContainer.querySelector('.discord-translate-button')) {
        debugLog('Translate button already exists');
        return;
      }
      
      // Create translate button
      const translateButton = document.createElement('div');
      translateButton.className = 'discord-translate-button button__74017 button__24af7';
      translateButton.setAttribute('aria-label', 'Çevir');
      translateButton.setAttribute('role', 'button');
      translateButton.setAttribute('tabindex', '0');
      translateButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: transparent;
        border: none;
        cursor: pointer;
        border-radius: 4px;
        margin-right: 8px;
        order: -9999;
      `;
      
      // Add translation SVG icon
      translateButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
        </svg>
      `;
      
      // Add click event
      translateButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        debugLog('Translate button clicked!');
        this.handleWritingTranslation();
      });
      
      // Add hover effects
      translateButton.addEventListener('mouseenter', () => {
        translateButton.style.background = 'rgba(114, 137, 218, 0.1)';
      });
      
      translateButton.addEventListener('mouseleave', () => {
        translateButton.style.background = 'transparent';
      });
      
      // Insert button at the beginning of buttons container
      buttonsContainer.insertBefore(translateButton, buttonsContainer.firstChild);
      
      debugLog('Translate button added successfully!');
    };
    
    // Start trying to add the button
    addButtonToMessageInput();
    
    // Also try again every 5 seconds in case Discord changes the UI
    setInterval(addButtonToMessageInput, 5000);
    
    debugLog('=== SETUP TRANSLATE BUTTON COMPLETED (SIMPLE METHOD) ===');
  }

  // Check if element is a Discord message input area
  isMessageInputArea(element) {
    if (!element || !element.classList) {
      debugLog('Element has no classList');
      return false;
    }

    // Check for Discord message input area classes
    const hasInputClasses = element.classList.toString().includes('buttons') ||
                           element.classList.toString().includes('scrollableContainer') ||
                           element.classList.toString().includes('inner');

    // Check if it contains message input elements
    const hasInputElements = element.querySelector('[class*="textArea"]') ||
                            element.querySelector('[role="textbox"]') ||
                            element.querySelector('[contenteditable="true"]');

    debugLog(`Element check - hasInputClasses: ${hasInputClasses}, hasInputElements: ${!!hasInputElements}`);
    
    return hasInputClasses && hasInputElements;
  }

  // Add translate button to existing message input areas
  addTranslateButtonToExistingInputAreas() {
    // Find message input areas more specifically - look for the actual message input container
    const messageInputContainers = document.querySelectorAll('[class*="scrollableContainer"]');
    debugLog(`Found ${messageInputContainers.length} scrollable containers`);
    
    messageInputContainers.forEach((container, index) => {
      debugLog(`Checking container ${index}:`, container.className);
      
      // Check if this container has a text area (message input)
      const textArea = container.querySelector('[class*="textArea"]');
      if (textArea) {
        debugLog(`Container ${index} has text area, looking for buttons`);
        
        // Find the buttons container within this message input area
        const buttonsContainer = container.querySelector('[class*="buttons"]');
        if (buttonsContainer) {
          debugLog(`Found buttons container in message input:`, buttonsContainer.className);
          this.addTranslateButtonToInputArea(buttonsContainer);
        } else {
          debugLog(`No buttons container found in message input area`);
        }
      } else {
        debugLog(`Container ${index} has no text area, skipping`);
      }
    });
  }

  // Update existing translate button texts when language changes
  updateTranslateButtonTexts() {
    const currentLang = localStorage.getItem('discord-translator-language') || 'en';
    const buttonText = currentLang === 'tr' ? 'Mesajı Çevir' : 'Translate';
    
    console.log('[Discord Translator] Updating button texts - Language:', currentLang, 'Text:', buttonText);
    
    // Update all existing translate buttons
    const translateButtons = document.querySelectorAll('[data-translate-button="true"]');
    console.log('[Discord Translator] Found', translateButtons.length, 'translate buttons to update');
    
    let updatedCount = 0;
    translateButtons.forEach((button, index) => {
      const buttonElement = button.querySelector('.button__74017');
      if (buttonElement) {
        buttonElement.setAttribute('aria-label', buttonText);
        buttonElement.setAttribute('title', buttonText);
        console.log(`[Discord Translator] Updated button ${index + 1}:`, buttonText);
        updatedCount++;
      } else {
        console.log(`[Discord Translator] Button ${index + 1} has no .button__74017 element`);
      }
    });
    
    // Also try to update any buttons that might not have the data attribute
    const allButtons = document.querySelectorAll('.discord-translate-button');
    allButtons.forEach((button, index) => {
      const buttonElement = button.querySelector('.button__74017');
      if (buttonElement && !buttonElement.getAttribute('aria-label').includes(buttonText)) {
        buttonElement.setAttribute('aria-label', buttonText);
        buttonElement.setAttribute('title', buttonText);
        console.log(`[Discord Translator] Updated additional button ${index + 1}:`, buttonText);
        updatedCount++;
      }
    });
    
    // Force update all translate buttons with more aggressive selectors
    const allTranslateButtons = document.querySelectorAll('[aria-label*="Mesajı Çevir"], [aria-label*="Translate"], [title*="Mesajı Çevir"], [title*="Translate"]');
    allTranslateButtons.forEach((element, index) => {
      if (element.getAttribute('aria-label') !== buttonText) {
        element.setAttribute('aria-label', buttonText);
        element.setAttribute('title', buttonText);
        console.log(`[Discord Translator] Force updated element ${index + 1}:`, buttonText);
        updatedCount++;
      }
    });
    
    console.log(`[Discord Translator] Total buttons updated: ${updatedCount}`);
    debugLog(`Updated translate button texts to: ${buttonText}`);
  }

  // Add translate button to a specific input area
  addTranslateButtonToInputArea(inputArea) {
    // Check if translate button already exists
    if (inputArea.querySelector('.discord-translate-button')) {
      debugLog('Translate button already exists in this input area');
      return;
    }

    // Find the main buttons container (buttons__74017)
    let buttonsContainer = inputArea.querySelector('[class*="buttons"]');
    
    // If no buttons container found, try to find a suitable place to add the button
    if (!buttonsContainer) {
      // Look for the main container that holds buttons
      buttonsContainer = inputArea.querySelector('[class*="buttonContainer"]') ||
                        inputArea.querySelector('[class*="expression-picker-chat-input-button"]')?.parentElement;
    }

    if (!buttonsContainer) {
      debugLog('No suitable buttons container found for translate button');
      return;
    }

    debugLog('Adding translate button to input area');

    // Create translate button
    const translateButton = document.createElement('div');
    translateButton.className = 'discord-translate-button expression-picker-chat-input-button buttonContainer__74017';
    translateButton.setAttribute('data-translate-button', 'true');
    
    // Force the button to be first with CSS order
    translateButton.style.order = '-9999';
    translateButton.style.position = 'relative';
    translateButton.style.zIndex = '1000';

    // Create button element
    const button = document.createElement('div');
    button.className = 'button__74017 button__24af7';
    // Get current language setting and set appropriate button text
    const currentLang = localStorage.getItem('discord-translator-language') || 'en';
    const buttonText = currentLang === 'tr' ? 'Mesajı Çevir' : 'Translate';
    console.log('[Discord Translator] Current language:', currentLang, 'Button text:', buttonText);
    button.setAttribute('aria-label', buttonText);
    button.setAttribute('title', buttonText);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-disabled', 'false');
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');

    // Create button wrapper
    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'buttonWrapper__24af7';
    buttonWrapper.style.cssText = 'opacity: 1; transform: none;';

    // Create icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'lottieIcon__5eb9b lottieIconColors__5eb9b';
    iconContainer.style.cssText = '--__lottieIconColor: currentColor; display: flex; width: 20px; height: 20px;';

    // Create SVG icon for translate
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.cssText = 'width: 100%; height: 100%; transform: translate3d(0px, 0px, 0px); content-visibility: visible;';

    // Create translate icon path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z');

    svg.appendChild(path);
    iconContainer.appendChild(svg);
    buttonWrapper.appendChild(iconContainer);
    button.appendChild(buttonWrapper);
    translateButton.appendChild(button);

    // Add click event listener
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      debugLog('Translate button clicked');
      this.handleWritingTranslation();
    });

    // Add hover effects
    button.addEventListener('mouseenter', () => {
      button.style.opacity = '0.8';
    });

    button.addEventListener('mouseleave', () => {
      button.style.opacity = '1';
    });

    // Create a table structure to force the translate button to be leftmost
    const table = document.createElement('table');
    table.style.cssText = `
      border-collapse: collapse;
      border-spacing: 0;
      width: 100%;
      margin: 0;
      padding: 0;
      display: table;
    `;

    const tbody = document.createElement('tbody');
    tbody.style.cssText = `
      display: table-row-group;
      vertical-align: middle;
    `;

    const tr = document.createElement('tr');
    tr.style.cssText = `
      display: table-row;
      vertical-align: middle;
    `;

    // Create first cell for translate button
    const translateCell = document.createElement('td');
    translateCell.style.cssText = `
      display: table-cell;
      vertical-align: middle;
      padding: 0;
      margin: 0;
      border: none;
      width: auto;
    `;

    // Create second cell for all other buttons
    const otherButtonsCell = document.createElement('td');
    otherButtonsCell.style.cssText = `
      display: table-cell;
      vertical-align: middle;
      padding: 0;
      margin: 0;
      border: none;
      width: 100%;
    `;

    // Move ALL existing buttons to the second cell (including gift button)
    const existingButtons = Array.from(buttonsContainer.children);
    debugLog(`Found ${existingButtons.length} existing buttons to move`);
    
    existingButtons.forEach((button, index) => {
      debugLog(`Moving button ${index}:`, button.className, button.getAttribute('aria-label'));
      otherButtonsCell.appendChild(button);
    });

    // Add translate button to first cell
    translateCell.appendChild(translateButton);

    // Assemble the table structure
    tr.appendChild(translateCell);
    tr.appendChild(otherButtonsCell);
    tbody.appendChild(tr);
    table.appendChild(tbody);

    // Replace the buttons container content with our table
    buttonsContainer.innerHTML = '';
    buttonsContainer.appendChild(table);

    debugLog('Translate button positioned using table structure - all buttons moved to second cell');

    // Update button text after adding
    setTimeout(() => {
      this.updateTranslateButtonTexts();
    }, 100);

    debugLog('Translate button added to message input area');
  }

  async handleWritingTranslation() {
    try {
      debugLog('Writing translation shortcut triggered');

      // Check if writing translation is enabled in settings
      if (!this.settings || !this.settings.writingEnabled) {
        debugLog('Writing translation is disabled in settings');
        this.showNotification('', 'warning');
        return;
      }

      // Find the active Discord message input
      const inputElement = this.findDiscordMessageInput();

      if (!inputElement) {
        debugLog('No Discord message input found');
        this.showNotification('', 'error');
        return;
      }

      // Extract current text from the input
      const currentText = this.extractTextFromInput(inputElement);

      if (!currentText || currentText.trim().length === 0) {
        debugLog('No text found in message input');
        this.showNotification('', 'warning');
        return;
      }

      debugLog('Text to translate:', currentText);
      debugLog('Input element before translation:', inputElement.innerHTML);
      debugLog('Input element text content before:', inputElement.textContent);

      // Show loading notification and indicator (icon only)
      this.showNotification('', 'loading');
      this.showWritingTranslationLoading(inputElement);

      // Request translation from background script
      const translationResult = await this.requestTranslation(
        currentText,
        this.settings.writingTargetLang
      );

      // Only hide input loading indicator, keep notification until success/error
      inputElement.style.opacity = '';
      inputElement.style.pointerEvents = '';
      delete inputElement.dataset.translatorLoading;

      if (translationResult.success) {
        if (translationResult.skipped) {
          debugLog('Translation skipped:', translationResult.reason);
          // Hide loading notification and show skip message
          this.hideLoadingNotification();
          this.showNotification('', 'info');
        } else {
          debugLog('Translation successful, replacing text...');
          debugLog('Original text:', currentText);
          debugLog('Translated text:', translationResult.translatedText);

          // Replace the text in the input with the translation
          await this.replaceTextInInput(inputElement, translationResult.translatedText);

          debugLog('Text replacement completed');
          debugLog('Input element after translation:', inputElement.innerHTML);
          debugLog('Input element text content after:', inputElement.textContent);

          // Hide loading notification and show success message (icon only)
          this.hideLoadingNotification();
          this.showNotification('', 'success');
        }
      } else {
        // Hide loading notification and show error message
        this.hideLoadingNotification();
        console.error('Translation failed:', translationResult.error);
        this.showWritingTranslationError(translationResult.error);
      }

    } catch (error) {
      // Hide loading notification and show error message
      this.hideLoadingNotification();
      console.error('Error in writing translation:', error);
      this.showWritingTranslationError(error.message);
    }
  }

  findDiscordMessageInput() {
    // Try to find the Discord message input using multiple selectors

    // First try to find the editable div (most reliable)
    for (const selector of this.inputSelectors.editableDiv) {
      const element = document.querySelector(selector);
      if (element && this.isValidMessageInput(element)) {
        debugLog('Found message input with selector:', selector);
        return element;
      }
    }

    // Fallback: look for any contenteditable element that looks like a message input
    const contentEditables = document.querySelectorAll('[contenteditable="true"]');
    for (const element of contentEditables) {
      if (this.isValidMessageInput(element)) {
        debugLog('Found message input via contenteditable fallback');
        return element;
      }
    }

    return null;
  }

  isValidMessageInput(element) {
    // Check if this element is likely a Discord message input

    // Should be contenteditable
    if (element.getAttribute('contenteditable') !== 'true') {
      return false;
    }

    // Should have role="textbox"
    if (element.getAttribute('role') !== 'textbox') {
      return false;
    }

    // Should be visible and not disabled
    if (element.style.display === 'none' || element.disabled) {
      return false;
    }

    // Check if it's in a text area container
    const textAreaContainer = element.closest('[class*="textArea"]');
    if (!textAreaContainer) {
      return false;
    }

    return true;
  }

  extractTextFromInput(inputElement) {
    // Discord uses Slate.js editor, so we need to extract text properly

    // First try to get text from slate text nodes
    const slateTextNodes = inputElement.querySelectorAll('[data-slate-node="text"]');
    if (slateTextNodes.length > 0) {
      let text = '';
      slateTextNodes.forEach(node => {
        text += node.textContent || '';
      });
      return text.trim();
    }

    // Fallback: use textContent
    return inputElement.textContent?.trim() || '';
  }

  async replaceTextInInput(inputElement, newText) {
    // Discord uses Slate.js, so we need to properly replace the content
    // The key is to simulate user input rather than direct DOM manipulation

    try {
      // Focus the input first
      inputElement.focus();

      // Wait a bit for focus to take effect
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if the text is already correct (to prevent multiple replacements)
      const currentContent = inputElement.textContent || '';
      if (currentContent === newText) {
        debugLog('Text is already correct, no replacement needed');
        return;
      }

      debugLog('Current content before replacement:', currentContent);
      debugLog('Target content:', newText);

      // Use keyboard simulation method (no DOM manipulation)
      debugLog('Using keyboard simulation method');
      const success = await this.replaceViaKeyboardSimulation(inputElement, newText);

      if (success) {
        debugLog('Text replacement successful');
        return;
      }

      // Fallback: Try simple paste simulation
      debugLog('Keyboard simulation failed, trying paste simulation');
      await this.simulatePasteReplacement(inputElement, newText);

    } catch (error) {
      console.error('Error replacing text in input:', error);
      // Final fallback - just log the error
      debugLog('All text replacement methods failed');
    }
  }













  async replaceViaKeyboardSimulation(inputElement, newText) {
    try {
      debugLog('Using keyboard simulation method');

      // Focus the input first
      inputElement.focus();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get current content using Slate.js aware extraction
      const originalContent = this.extractTextFromInput(inputElement);
      debugLog('Original content length:', originalContent.length);
      debugLog('Original content:', originalContent);

      // Clear existing text using Selection API and character-by-character backspace
      if (originalContent.length > 0) {
        debugLog('Clearing existing text with Selection API + backspace simulation');

        // Method 1: Try using Selection API to select all content
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(inputElement);
          selection.removeAllRanges();
          selection.addRange(range);
          await new Promise(resolve => setTimeout(resolve, 50));

          // Now simulate backspace to delete selected content
          await this.simulateKeyPress(inputElement, 'Backspace');
          await new Promise(resolve => setTimeout(resolve, 100));

          const afterSelectionDelete = this.extractTextFromInput(inputElement);
          debugLog('Content after selection + backspace:', afterSelectionDelete.length);

          if (afterSelectionDelete.length === 0) {
            debugLog('Content cleared with Selection API method');
          } else {
            throw new Error('Selection API method failed');
          }
        } catch (selectionError) {
          debugLog('Selection API failed, trying character-by-character backspace');

          // Method 2: Character-by-character backspace (fallback)
          // Move cursor to the end first
          await this.simulateKeyPress(inputElement, 'End');
          await new Promise(resolve => setTimeout(resolve, 50));

          // Calculate how many backspaces we need based on original content length
          const backspaceCount = originalContent.length;
          debugLog(`Will simulate ${backspaceCount} backspace presses`);

          for (let i = 0; i < backspaceCount; i++) {
            await this.simulateKeyPress(inputElement, 'Backspace');
            await new Promise(resolve => setTimeout(resolve, 30));

            // Check every 5 backspaces to see if we're done
            if (i % 5 === 0 || i === backspaceCount - 1) {
              const currentContent = this.extractTextFromInput(inputElement);
              debugLog(`After ${i + 1} backspaces: remaining length = ${currentContent.length}`);

              if (currentContent.length === 0) {
                debugLog('Content cleared after', i + 1, 'backspace presses');
                break;
              }
            }
          }

          // Final check and additional cleanup if needed
          const finalContent = this.extractTextFromInput(inputElement);
          if (finalContent.length > 0) {
            debugLog('Still has content, trying additional cleanup');
            // Try a few more backspaces for any remaining characters
            for (let i = 0; i < 15; i++) {
              await this.simulateKeyPress(inputElement, 'Backspace');
              await new Promise(resolve => setTimeout(resolve, 20));

              const checkContent = this.extractTextFromInput(inputElement);
              if (checkContent.length === 0) {
                debugLog('Content cleared with additional cleanup');
                break;
              }
            }
          }
        }
      }

      // Step 3: Type the new text
      debugLog('Simulating typing new text');
      await this.simulateTyping(inputElement, newText);

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 200));
      const content = inputElement.textContent || '';

      if (content === newText) {
        debugLog('Keyboard simulation method - SUCCESS');
        return true;
      } else {
        debugLog('Keyboard simulation verification failed');
        debugLog('Expected:', newText);
        debugLog('Got:', content);
        return false;
      }

    } catch (error) {
      console.error('Keyboard simulation method failed:', error);
      return false;
    }
  }

  async simulateKeyPress(element, key, modifiers = {}) {
    // Get the correct key code for special keys
    let keyCode;
    if (key === 'Delete') {
      keyCode = 'Delete';
    } else if (key === 'Backspace') {
      keyCode = 'Backspace';
    } else if (key === 'Home') {
      keyCode = 'Home';
    } else if (key === 'End') {
      keyCode = 'End';
    } else if (key === ' ') {
      keyCode = 'Space';
    } else if (key.length === 1) {
      keyCode = `Key${key.toUpperCase()}`;
    } else {
      keyCode = key;
    }

    // Create more comprehensive events
    const keyDownEvent = new KeyboardEvent('keydown', {
      key: key,
      code: keyCode,
      bubbles: true,
      cancelable: true,
      ...modifiers
    });

    const keyPressEvent = new KeyboardEvent('keypress', {
      key: key,
      code: keyCode,
      bubbles: true,
      cancelable: true,
      ...modifiers
    });

    const keyUpEvent = new KeyboardEvent('keyup', {
      key: key,
      code: keyCode,
      bubbles: true,
      cancelable: true,
      ...modifiers
    });

    // Dispatch events in sequence
    element.dispatchEvent(keyDownEvent);
    await new Promise(resolve => setTimeout(resolve, 20));

    // Only dispatch keypress for printable characters
    if (key.length === 1) {
      element.dispatchEvent(keyPressEvent);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // For deletion keys, also dispatch input events
    if (key === 'Delete' || key === 'Backspace') {
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward'
      });
      element.dispatchEvent(inputEvent);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    element.dispatchEvent(keyUpEvent);
  }

  async simulateTyping(element, text) {
    debugLog('Typing text character by character:', text);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Create keyboard events for each character
      const keyDownEvent = new KeyboardEvent('keydown', {
        key: char,
        code: this.getKeyCode(char),
        bubbles: true,
        cancelable: true
      });

      const keyPressEvent = new KeyboardEvent('keypress', {
        key: char,
        code: this.getKeyCode(char),
        bubbles: true,
        cancelable: true
      });

      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char
      });

      const keyUpEvent = new KeyboardEvent('keyup', {
        key: char,
        code: this.getKeyCode(char),
        bubbles: true,
        cancelable: true
      });

      // Dispatch events in order
      element.dispatchEvent(keyDownEvent);
      element.dispatchEvent(keyPressEvent);
      element.dispatchEvent(inputEvent);
      element.dispatchEvent(keyUpEvent);

      // Small delay between characters to simulate real typing
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  getKeyCode(char) {
    // Convert character to appropriate KeyCode
    if (char === ' ') return 'Space';
    if (char.match(/[a-zA-Z]/)) return `Key${char.toUpperCase()}`;
    if (char.match(/[0-9]/)) return `Digit${char}`;
    return `Key${char.toUpperCase()}`;
  }

  async simulatePasteReplacement(inputElement, newText) {
    try {
      debugLog('Using paste simulation fallback');

      // Focus the input
      inputElement.focus();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Select all text first
      await this.simulateKeyPress(inputElement, 'a', { ctrlKey: true });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Delete selected text
      debugLog('Simulating Backspace key to remove selected text');
      await this.simulateKeyPress(inputElement, 'Backspace');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create clipboard data and paste event
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', newText);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboardData
      });

      inputElement.dispatchEvent(pasteEvent);

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 200));
      const content = inputElement.textContent || '';

      if (content === newText) {
        debugLog('Paste simulation - SUCCESS');
      } else {
        debugLog('Paste simulation failed');
        debugLog('Expected:', newText);
        debugLog('Got:', content);
      }

    } catch (error) {
      console.error('Paste simulation failed:', error);
    }
  }





  showWritingTranslationLoading(inputElement) {
    // Add a subtle loading indicator
    inputElement.style.opacity = '0.7';
    inputElement.style.pointerEvents = 'none';

    // Add a data attribute to track loading state
    inputElement.dataset.translatorLoading = 'true';
  }

  hideWritingTranslationLoading(inputElement) {
    // Remove loading indicator from input only
    inputElement.style.opacity = '';
    inputElement.style.pointerEvents = '';

    // Remove loading state
    delete inputElement.dataset.translatorLoading;

    // Note: Loading notification is now hidden manually in handleWritingTranslation
  }

  showNotification(message, type = 'info', duration = 3000) {
    // Remove any existing notifications first
    const existingNotifications = document.querySelectorAll('.discord-translator-notification');
    existingNotifications.forEach(notification => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });

    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'discord-translator-notification';

    // Set colors and icons based on type
    let backgroundColor, icon;
    switch (type) {
      case 'success':
        backgroundColor = '#43b581';
        icon = '✓';
        break;
      case 'error':
        backgroundColor = '#f04747';
        icon = '❌';
        break;
      case 'warning':
        backgroundColor = '#faa61a';
        icon = '⚠️';
        break;
      case 'loading':
        backgroundColor = '#7289da';
        icon = '🔄';
        duration = 0; // Loading notifications don't auto-hide
        break;
      case 'info':
      default:
        backgroundColor = '#7289da';
        icon = 'ℹ️';
        break;
    }

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: ${backgroundColor};
      color: white;
      padding: 8px;
      border-radius: 50%;
      font-family: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 18px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      animation: slideInFromRight 0.3s ease-out;
      transition: all 0.3s ease;
    `;

    // Add CSS animation keyframes if not already added
    if (!document.querySelector('#discord-translator-animations')) {
      const style = document.createElement('style');
      style.id = 'discord-translator-animations';
      style.textContent = `
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOutToRight {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        .discord-translator-notification.loading .loading-spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // Create content (icon only)
    const iconSpan = document.createElement('span');
    if (type === 'loading') {
      iconSpan.className = 'loading-spinner';
      iconSpan.textContent = icon;
    } else {
      iconSpan.textContent = icon;
    }

    // Only add icon, no message text
    notification.appendChild(iconSpan);

    // Add to page
    document.body.appendChild(notification);

    // Auto-hide after duration (except for loading notifications)
    if (duration > 0) {
      setTimeout(() => {
        if (notification.parentNode) {
          notification.style.animation = 'slideOutToRight 0.3s ease-in';
          setTimeout(() => {
            if (notification.parentNode) {
              notification.parentNode.removeChild(notification);
            }
          }, 300);
        }
      }, duration);
    }

    // Store reference for loading notifications so we can hide them manually
    if (type === 'loading') {
      this.currentLoadingNotification = notification;
    }

    return notification;
  }

  hideLoadingNotification() {
    if (this.currentLoadingNotification && this.currentLoadingNotification.parentNode) {
      this.currentLoadingNotification.style.animation = 'slideOutToRight 0.3s ease-in';
      setTimeout(() => {
        if (this.currentLoadingNotification && this.currentLoadingNotification.parentNode) {
          this.currentLoadingNotification.parentNode.removeChild(this.currentLoadingNotification);
        }
        this.currentLoadingNotification = null;
      }, 300);
    }
  }

  showWritingTranslationError(errorMessage) {
    this.showNotification('', 'error', 5000);
  }

  // Method to restart observer if Discord navigation occurs
  restartObserver() {
    debugLog('Restarting Discord message observer');

    if (this.observer) {
      this.observer.disconnect();
    }

    // Wait a bit for Discord to settle after navigation
    setTimeout(() => {
      this.observeMessages();
    }, 1000);
  }

  // Method to check if we're still on a Discord page with messages
  isOnDiscordMessagesPage() {
    // Check for Discord-specific elements that indicate we're on a messages page
    const indicators = [
      '[class*="messages-"]',
      '[class*="chatContent-"]',
      '[class*="messageContent-"]',
      '[data-list-id="chat-messages"]'
    ];

    return indicators.some(selector => document.querySelector(selector));
  }

  // Method to handle Discord's SPA navigation
  handleDiscordNavigation() {
    // Listen for Discord's navigation events
    let lastUrl = location.href;

    const checkForNavigation = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        debugLog('Discord navigation detected, checking if restart needed');

        // If we're still on a messages page but observer might be stale
        if (this.isOnDiscordMessagesPage()) {
          this.restartObserver();
        }
      }
    };

    // Check for URL changes (Discord uses pushState)
    setInterval(checkForNavigation, 2000);

    // Also listen for popstate events
    window.addEventListener('popstate', () => {
      setTimeout(() => {
        if (this.isOnDiscordMessagesPage()) {
          this.restartObserver();
        }
      }, 500);
    });
  }

  // Method to test selectors against current page (for debugging)
  testSelectors() {
    debugLog('Testing Discord selectors against current page:');

    Object.entries(this.messageSelectors).forEach(([category, selectors]) => {
      debugLog(`\n${category}:`);
      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        debugLog(`  ${selector}: ${elements.length} elements found`);
        if (elements.length > 0 && elements.length <= 3) {
          // Show first few elements for debugging
          elements.forEach((el, index) => {
            debugLog(`    [${index}] ${el.tagName}${el.className ? '.' + el.className.split(' ').join('.') : ''}${el.id ? '#' + el.id : ''}`);
          });
        }
      });
    });

    // Test message detection
    const allMessages = this.findAllMessageElements();
    debugLog(`\nTotal valid messages found: ${allMessages.length}`);

    if (allMessages.length > 0) {
      const sampleMessage = allMessages[0];
      const messageData = this.extractMessageData(sampleMessage);
      debugLog('Sample message data:', messageData);
    }
  }

  // Enhanced cleanup method
  destroy() {
    debugLog('Destroying Discord Translator');

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clean up message input observer
    if (this.messageInputObserver) {
      this.messageInputObserver.disconnect();
      this.messageInputObserver = null;
    }

    // Remove event listeners
    document.removeEventListener('discordMessageDetected', this.messageEventHandler);

    // Remove all translation containers
    const translationContainers = document.querySelectorAll('.discord-translator-container');
    translationContainers.forEach(container => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    // Remove all translation overlays
    const translationOverlays = document.querySelectorAll('.discord-translator-overlay');
    translationOverlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    // Remove all notifications
    const notifications = document.querySelectorAll('.discord-translator-notification');
    notifications.forEach(notification => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });

    // Remove translate buttons from message input areas
    const translateButtons = document.querySelectorAll('.discord-translate-button');
    translateButtons.forEach(button => {
      if (button.parentNode) {
        button.parentNode.removeChild(button);
      }
    });

    // Clean up click translation
    this.cleanupClickTranslation();

    // Clear processing flags
    const processedMessages = document.querySelectorAll('[data-translator-auto-processed="true"]');
    processedMessages.forEach(msg => {
      delete msg.dataset.translatorAutoProcessed;
    });

    // Clear any intervals or timeouts
    this.currentLoadingNotification = null;
    this.isInitialized = false;
  }
}

// Initialize the translator when the page loads
let translator = null;

// Wait for page to be ready
console.log('[Discord Translator] Document ready state:', document.readyState);

if (document.readyState === 'loading') {
  console.log('[Discord Translator] Document still loading, waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Discord Translator] DOMContentLoaded fired, creating translator...');
    translator = new DiscordTranslator();
  });
} else {
  console.log('[Discord Translator] Document already ready, creating translator immediately...');
  translator = new DiscordTranslator();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (translator) {
    translator.destroy();
  }
});

// Expose translator for debugging (only in debug mode)
if (DEBUG_MODE) {
  window.discordTranslator = translator;

  // Add console helper functions
  window.testDiscordSelectors = () => {
    if (translator) {
      translator.testSelectors();
    } else {
      console.log('Translator not initialized yet');
    }
  };

  window.findDiscordMessages = () => {
    if (translator) {
      return translator.findAllMessageElements();
    } else {
      console.log('Translator not initialized yet');
      return [];
    }
  };

  window.checkTranslatorStatus = () => {
    if (translator) {
      console.log('Translator Status:');
      console.log('- Initialized:', translator.isInitialized);
      console.log('- Settings:', translator.settings);
      console.log('- Reading Mode:', translator.settings?.readingMode);

      const messages = translator.findAllMessageElements();
      console.log('- Found Messages:', messages.length);

      const linksCount = document.querySelectorAll('.discord-translator-link').length;
      console.log('- Translation Links:', linksCount);

      return {
        initialized: translator.isInitialized,
        settings: translator.settings,
        messagesFound: messages.length,
        linksCount: linksCount
      };
    } else {
      console.log('Translator not initialized yet');
      return null;
    }
  };

  window.updateTranslateButtons = () => {
    if (translator) {
      translator.updateTranslateButtonTexts();
      console.log('Translate buttons updated manually');
    } else {
      console.log('Translator not initialized yet');
    }
  };
}

// Listen for language changes in localStorage
window.addEventListener('storage', (e) => {
  if (e.key === 'discord-translator-language' && translator) {
    console.log('[Discord Translator] Language changed, updating button texts...');
    translator.updateTranslateButtonTexts();
  }
});

// Also listen for language changes in the same tab
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.apply(this, arguments);
  if (key === 'discord-translator-language' && translator) {
    console.log('[Discord Translator] Language changed in same tab, updating button texts...');
    translator.updateTranslateButtonTexts();
  }
};

// Periodic check for language changes (fallback)
setInterval(() => {
  if (translator) {
    const currentLang = localStorage.getItem('discord-translator-language') || 'en';
    if (translator.lastKnownLanguage !== currentLang) {
      console.log('[Discord Translator] Language change detected via periodic check:', currentLang);
      translator.lastKnownLanguage = currentLang;
      translator.updateTranslateButtonTexts();
    }
  }
}, 2000); // Check every 2 seconds

// More frequent check for button updates
setInterval(() => {
  if (translator) {
    translator.updateTranslateButtonTexts();
  }
}, 10000); // Force update every 10 seconds

