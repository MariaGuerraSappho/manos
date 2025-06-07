import HandTracker from './handTracking.js';
import AudioEngine from './audioEngine.js';
import ParameterMapper from './parameterMapper.js';

class ManosApp {
    constructor() {
        // State
        this.appState = {
            uploadedFiles: [],
            selectedMic: null,
            selectedOutput: null,
            audioSource: 'noise',
            loop: false
        };

        // UI Elements (video container is shared!)
        this.setupModeContainer = document.getElementById('setup-mode');
        this.performanceModeContainer = document.getElementById('performance-mode');

        // Controls - Setup
        this.noiseButton = document.getElementById('noise-btn');
        this.micButton = document.getElementById('mic-btn');
        this.fileButton = document.getElementById('file-btn');
        this.fileInput = document.getElementById('audio-upload');
        this.playButton = document.getElementById('play-btn');
        this.stopButton = document.getElementById('stop-btn');
        this.randomizeButton = document.getElementById('randomize-btn');
        this.saveSettingsButton = document.getElementById('save-settings-btn');
        this.startPerformanceButton = document.getElementById('start-performance-btn');
        this.fileBrowserElement = document.getElementById('file-browser');
        this.fileListElement = document.getElementById('file-list');
        this.micSelect = document.getElementById('mic-select');
        this.outputSelect = document.getElementById('output-select');
        this.activeMappingsElement = document.getElementById('active-mappings');
        this.activeEffectsListElement = document.getElementById('active-effects-list');

        // Controls - Performance
        this.performanceNoiseButton = document.getElementById('performance-noise-btn');
        this.performanceMicButton = document.getElementById('performance-mic-btn');
        this.performanceFileButton = document.getElementById('performance-file-btn');
        this.performanceRandomizeButton = document.getElementById('randomize-btn');
        this.performanceSaveButton = document.getElementById('performance-save-btn');
        this.performancePlayButton = document.getElementById('performance-play-btn');
        this.performanceStopButton = document.getElementById('performance-stop-btn');
        this.performanceActiveMappingsElement = document.getElementById('performance-active-mappings');
        this.exitPerformanceButton = document.getElementById('exit-performance-btn');
        this.performanceNextFileButton = document.getElementById('performance-next-file-btn');
        this.performanceEffectsList = document.getElementById('performance-effects-list');

        // Hand/audio modules
        this.handTracker = new HandTracker();
        this.audioEngine = new AudioEngine();
        this.parameterMapper = new ParameterMapper(this.audioEngine);

        this.initialized = false;
        this.inPerformanceMode = false;

        this.populatePerformanceUI = this.populatePerformanceUI.bind(this);
    }

    async initialize() {
        try {
            // Request permissions immediately when app loads
            await this.requestPermissions();
            
            await this.audioEngine.initialize();
            await this.handTracker.initialize();
            this.handTracker.setHandUpdateCallback(this.onHandUpdate.bind(this));
            this.handTracker.setGestureDetectedCallback(this.onGestureDetected.bind(this));
            this.setupEventListeners();
            this.parameterMapper.createRandomMappings();
            this.updateMappingsDisplay();
            this.updateActiveEffectsList();
            
            // Ensure a default source is always set
            await this.audioEngine.startAudioContext();
            await this.audioEngine.setSource('noise');
            this.appState.audioSource = 'noise';
            this.updateSourceButtons('noise');
            
            this.loadSavedSettingsList();
            this.initialized = true;
            this.checkDeviceType();

            // Initialize volume display
            const volumeSlider = document.getElementById('baseline-volume');
            const volumeDisplay = document.getElementById('volume-display');
            if (volumeSlider && volumeDisplay) {
                volumeDisplay.textContent = `${volumeSlider.value} dB`;
                this.audioEngine.setBaselineVolume(volumeSlider.value);
            }

            // Camera enable button
            const enableCameraBtn = document.getElementById('enable-camera');
            if (enableCameraBtn) {
                enableCameraBtn.addEventListener('click', async () => {
                    await this.handTracker.requestCameraPermission();
                });
            }

            // Set up volume test buttons
            this.setupVolumeTestControls();

            // Fix randomize button in performance mode
            if (document.getElementById('performance-randomize-btn')) {
                document.getElementById('performance-randomize-btn').addEventListener('click', () => {
                    const chaosSlider = document.getElementById('chaos-level');
                    const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                    
                    this.parameterMapper.createRandomMappings(undefined, chaosLevel);
                    this.updatePerformanceMappingsDisplay();
                    this.updateActiveEffectsList();
                });
            }
        } catch (error) {
            console.error('Error initializing Manos app:', error);
        }
    }
    
    setupVolumeTestControls() {
        const testToneBtn = document.getElementById('test-tone-btn');
        const testMinVolumeBtn = document.getElementById('test-min-volume-btn');
        const testMaxVolumeBtn = document.getElementById('test-max-volume-btn');
        const volumeSlider = document.getElementById('baseline-volume');
        const volumeDisplay = document.getElementById('volume-display');
        const volumeTestStatus = document.getElementById('volume-test-status');
        
        // Test tone button for normal volume
        if (testToneBtn) {
            testToneBtn.addEventListener('click', async () => {
                if (testToneBtn.textContent === "Play Test Tone") {
                    // Stop any other test modes
                    this.stopAllVolumeTests();
                    
                    // Start baseline test tone
                    await this.audioEngine.startAudioContext();
                    await this.audioEngine.startTestTone();
                    testToneBtn.textContent = "Stop Test Tone";
                    testToneBtn.classList.add('active');
                    
                    volumeTestStatus.textContent = 'Adjust the slider to set your preferred baseline volume';
                    volumeTestStatus.classList.add('testing');
                } else {
                    this.audioEngine.stopTestTone();
                    testToneBtn.textContent = "Play Test Tone";
                    testToneBtn.classList.remove('active');
                    volumeTestStatus.classList.remove('testing');
                }
            });
        }
        
        // Test minimum volume button
        if (testMinVolumeBtn) {
            testMinVolumeBtn.addEventListener('click', async () => {
                if (!testMinVolumeBtn.classList.contains('active')) {
                    // Stop any other test modes
                    this.stopAllVolumeTests();
                    
                    // Start minimum volume test
                    await this.audioEngine.startAudioContext();
                    await this.audioEngine.startTestToneWithOffset(-40); // Minimum volume
                    testMinVolumeBtn.classList.add('active');
                    
                    volumeTestStatus.textContent = 'Testing minimum volume (hand very close to camera)';
                    volumeTestStatus.classList.add('testing');
                } else {
                    this.audioEngine.stopTestTone();
                    testMinVolumeBtn.classList.remove('active');
                    volumeTestStatus.classList.remove('testing');
                }
            });
        }
        
        // Test maximum volume button
        if (testMaxVolumeBtn) {
            testMaxVolumeBtn.addEventListener('click', async () => {
                if (!testMaxVolumeBtn.classList.contains('active')) {
                    // Stop any other test modes
                    this.stopAllVolumeTests();
                    
                    // Start maximum volume test
                    await this.audioEngine.startAudioContext();
                    await this.audioEngine.startTestToneWithOffset(12); // Maximum volume
                    testMaxVolumeBtn.classList.add('active');
                    
                    volumeTestStatus.textContent = 'Testing maximum volume (hand far from camera)';
                    volumeTestStatus.classList.add('testing');
                } else {
                    this.audioEngine.stopTestTone();
                    testMaxVolumeBtn.classList.remove('active');
                    volumeTestStatus.classList.remove('testing');
                }
            });
        }
        
        // Volume slider
        if (volumeSlider && volumeDisplay) {
            volumeSlider.addEventListener('input', (e) => {
                const value = e.target.value;
                volumeDisplay.textContent = `${value} dB`;
                this.audioEngine.setBaselineVolume(value);
                console.log('Slider set:', value, 'audioEngine.baselineVolume:', this.audioEngine.baselineVolume);
            });
        }
    }
    
    stopAllVolumeTests() {
        const testToneBtn = document.getElementById('test-tone-btn');
        const testMinVolumeBtn = document.getElementById('test-min-volume-btn');
        const testMaxVolumeBtn = document.getElementById('test-max-volume-btn');
        const volumeTestStatus = document.getElementById('volume-test-status');
        
        this.audioEngine.stopTestTone();
        
        if (testToneBtn) {
            testToneBtn.textContent = "Play Test Tone";
            testToneBtn.classList.remove('active');
        }
        
        if (testMinVolumeBtn) {
            testMinVolumeBtn.classList.remove('active');
        }
        
        if (testMaxVolumeBtn) {
            testMaxVolumeBtn.classList.remove('active');
        }
        
        if (volumeTestStatus) {
            volumeTestStatus.classList.remove('testing');
        }
    }

    setupEventListeners() {
        // Setup Mode
        this.noiseButton?.addEventListener('click', () => this.selectSource('noise'));
        this.micButton?.addEventListener('click', () => this.selectSource('mic'));
        this.fileButton?.addEventListener('click', () => this.fileInput.click());
        this.fileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFileUpload(e.target.files);
        });
        this.playButton?.addEventListener('click', async () => {
            await this.audioEngine.startAudioContext();
            this.audioEngine.play();
            this.updatePlayStopButtons(true);
        });
        this.stopButton?.addEventListener('click', () => {
            this.audioEngine.stop();
            this.updatePlayStopButtons(false);
        });
        
        // Fix randomize button in setup mode
        if (document.getElementById('randomize-btn')) {
            document.getElementById('randomize-btn').addEventListener('click', () => {
                this.parameterMapper.createRandomMappings();
                this.updateMappingsDisplay();
                this.updateActiveEffectsList();
            });
        }
        
        this.saveSettingsButton?.addEventListener('click', () => this.saveCurrentSettings());
        this.startPerformanceButton?.addEventListener('click', () => this.enterPerformanceMode());

        // Performance Mode
        this.performanceNoiseButton?.addEventListener('click', () => this.changePerformanceSource('noise'));
        this.performanceMicButton?.addEventListener('click', () => this.changePerformanceSource('mic'));
        this.performanceFileButton?.addEventListener('click', () => this.changePerformanceSource('file'));
        this.performancePlayButton?.addEventListener('click', async () => {
            await this.audioEngine.startAudioContext();
            this.audioEngine.play();
            this.updatePlayStopButtons(true);
        });
        this.performanceStopButton?.addEventListener('click', () => {
            this.audioEngine.stop();
            this.updatePlayStopButtons(false);
        });
        
        // Add exit performance button event listener
        this.exitPerformanceButton?.addEventListener('click', () => this.exitPerformanceMode());
        
        // Chaos level handler
        const chaosSlider = document.getElementById('chaos-level');
        if (chaosSlider) {
            chaosSlider.addEventListener('input', (e) => {
                const chaosLevel = parseInt(e.target.value) / 100;
                this.parameterMapper.setChaosLevel(chaosLevel);
            });
        }

        // Dry/wet mix handler
        const dryWetSlider = document.getElementById('dry-wet');
        if (dryWetSlider) {
            dryWetSlider.addEventListener('input', (e) => {
                const mix = parseInt(e.target.value) / 100;
                this.audioEngine.setDryWet(mix);
            });
        }
        
        this.performanceNextFileButton?.addEventListener('click', () => {
            this.nextAudioFileWithFade();
        });

        // Device selectors
        this.micSelect?.addEventListener('change', (e) => {
            this.appState.selectedMic = e.target.value;
        });
        this.outputSelect?.addEventListener('change', (e) => {
            this.appState.selectedOutput = e.target.value;
        });

        // Drag and drop audio files
        document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        document.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                this.handleFileUpload(e.dataTransfer.files);
            }
        });
        window.addEventListener('resize', () => this.checkDeviceType());

        // Baseline volume slider
        const volumeSlider = document.getElementById('baseline-volume');
        const volumeDisplay = document.getElementById('volume-display');
        
        if (volumeSlider && volumeDisplay) {
            volumeSlider.addEventListener('input', (e) => {
                const value = e.target.value;
                volumeDisplay.textContent = `${value} dB`;
                this.audioEngine.setBaselineVolume(value);
                console.log('Slider set:', value, 'audioEngine.baselineVolume:', this.audioEngine.baselineVolume);
            });
        }
    }

    async selectSource(sourceType) {
        try {
            // Ensure audio context is started before setting source
            await this.audioEngine.startAudioContext();
            const ok = await this.audioEngine.setSource(sourceType);
            if (ok) {
                this.appState.audioSource = sourceType;
                this.updateSourceButtons(sourceType);
                if (sourceType === 'file') {
                    this.updateFileBrowser();
                    this.fileBrowserElement.classList.remove('hidden');
                } else {
                    this.fileBrowserElement.classList.add('hidden');
                }
            } else {
                console.error('Failed to set audio source:', sourceType);
            }
        } catch (error) {
            console.error('Error setting audio source:', error);
        }
    }

    async changePerformanceSource(sourceType) {
        try {
            const ok = await this.audioEngine.setSource(sourceType);
            if (ok) {
                this.appState.audioSource = sourceType;
                this.updatePerformanceSourceButtons(sourceType);
                
                // Show or hide file controls
                const fileControls = document.getElementById('performance-file-controls');
                if (sourceType === 'file' && fileControls) {
                    fileControls.style.display = 'block';
                } else if (fileControls) {
                    fileControls.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error setting performance audio source:', error);
        }
    }

    async handleFileUpload(files) {
        try {
            const result = await this.audioEngine.loadAudioFiles(files);
            if (result) {
                await this.selectSource('file');
                this.updateFileBrowser();
            }
        } catch (error) {
            console.error('Error uploading files:', error);
        }
    }

    updateFileBrowser() {
        if (!this.fileListElement) return;
        
        this.fileListElement.innerHTML = '';
        const fileList = this.audioEngine.getAudioFileList();
        
        if (fileList.length === 0) {
            this.fileListElement.innerHTML = '<p>No audio files loaded</p>';
            return;
        }
        
        fileList.forEach(file => {
            const fileElement = document.createElement('div');
            fileElement.classList.add('file-item');
            if (file.isCurrent) {
                fileElement.classList.add('current');
            }
            
            fileElement.innerHTML = `
                <span class="file-name">${file.name}</span>
                <button class="file-play-btn" data-index="${file.index}">
                    ${file.isCurrent ? 'Current' : 'Select'}
                </button>
            `;
            
            this.fileListElement.appendChild(fileElement);
            
            // Add click event for the play button
            const playBtn = fileElement.querySelector('.file-play-btn');
            playBtn.addEventListener('click', () => {
                this.audioEngine.currentFileIndex = file.index;
                this.audioEngine.loadCurrentFile().then(() => {
                    if (this.audioEngine.playing) {
                        this.audioEngine.stop();
                        this.audioEngine.play();
                    }
                    this.updateFileBrowser();
                });
            });
        });
    }

    updateSourceButtons(sourceType) {
        if (this.noiseButton) {
            this.noiseButton.classList.toggle('active', sourceType === 'noise');
        }
        if (this.micButton) {
            this.micButton.classList.toggle('active', sourceType === 'mic');
        }
        if (this.fileButton) {
            this.fileButton.classList.toggle('active', sourceType === 'file');
        }
    }

    updatePerformanceSourceButtons(sourceType) {
        if (this.performanceNoiseButton) {
            this.performanceNoiseButton.classList.toggle('active', sourceType === 'noise');
        }
        if (this.performanceMicButton) {
            this.performanceMicButton.classList.toggle('active', sourceType === 'mic');
        }
        if (this.performanceFileButton) {
            this.performanceFileButton.classList.toggle('active', sourceType === 'file');
        }
    }

    updatePlayStopButtons(isPlaying) {
        // Update setup mode buttons
        if (this.playButton) {
            this.playButton.disabled = isPlaying;
            this.playButton.classList.toggle('active', isPlaying);
        }
        if (this.stopButton) {
            this.stopButton.disabled = !isPlaying;
            this.stopButton.classList.toggle('active', !isPlaying);
        }
        
        // Update performance mode buttons
        if (this.performancePlayButton) {
            this.performancePlayButton.disabled = isPlaying;
            this.performancePlayButton.classList.toggle('active', isPlaying);
        }
        if (this.performanceStopButton) {
            this.performanceStopButton.disabled = !isPlaying;
            this.performanceStopButton.classList.toggle('active', !isPlaying);
        }
        
        // Update indicators
        const setupIndicator = document.getElementById('setup-stopped-indicator');
        const performanceIndicator = document.getElementById('performance-stopped-indicator');
        
        if (setupIndicator) {
            setupIndicator.classList.toggle('visible', !isPlaying);
        }
        
        if (performanceIndicator) {
            performanceIndicator.classList.toggle('visible', !isPlaying);
        }
    }

    onHandUpdate(handData) {
        // Only process hand data when audio is playing
        if (!this.audioEngine.playing) {
            return;
        }
        
        this.parameterMapper.processHandData(handData);
        this.updateActiveEffectsList();
    }

    onGestureDetected(gesture) {
        // Placeholder for future gesture detection functionality
    }

    updateMappingsDisplay() {
        if (!this.activeMappingsElement) return;
        
        const mappings = this.parameterMapper.getMappingsDescription();
        this.activeMappingsElement.innerHTML = '';
        
        mappings.forEach(mapping => {
            const mappingElement = document.createElement('div');
            mappingElement.classList.add('mapping-item');
            mappingElement.textContent = mapping.text;
            this.activeMappingsElement.appendChild(mappingElement);
        });
    }

    updatePerformanceMappingsDisplay() {
        if (!this.performanceActiveMappingsElement) return;
        
        const mappings = this.parameterMapper.getMappingsDescription();
        this.performanceActiveMappingsElement.innerHTML = '';
        
        mappings.forEach(mapping => {
            const mappingElement = document.createElement('div');
            mappingElement.classList.add('mapping-item');
            mappingElement.textContent = mapping.text;
            this.performanceActiveMappingsElement.appendChild(mappingElement);
        });
    }

    updateActiveEffectsList() {
        const activeChanges = this.parameterMapper.getActiveEffectChanges();
        const effectsList = this.inPerformanceMode ? this.performanceEffectsList : this.activeEffectsListElement;
        
        if (!effectsList || !activeChanges) return;
        
        // Keep a cache of effect elements
        if (!this.effectElements) {
            this.effectElements = {};
        }
        
        activeChanges.forEach(change => {
            const effectId = `${change.effectType}-${change.parameter}`;
            
            // Create or update effect elements
            if (!this.effectElements[effectId]) {
                const effectElement = document.createElement('div');
                effectElement.classList.add('effect-item');
                effectElement.innerHTML = `
                    <div class="effect-name">${change.effectType}: ${change.parameter}</div>
                    <div class="effect-value"></div>
                    <div class="effect-bar">
                        <div class="effect-bar-fill"></div>
                    </div>
                `;
                effectsList.appendChild(effectElement);
                this.effectElements[effectId] = {
                    element: effectElement,
                    valueElement: effectElement.querySelector('.effect-value'),
                    barFill: effectElement.querySelector('.effect-bar-fill')
                };
            }
            
            // Update the effect display
            const effectElement = this.effectElements[effectId];
            
            // Format the value display based on effect type
            let displayValue = '';
            if (change.effectType === 'volume') {
                // Special handling for volume to show dB values
                displayValue = `${change.value.toFixed(1)} dB`;
                if (change.baselineVolume !== undefined) {
                    displayValue += ` (Offset: ${(change.volumeOffset || 0).toFixed(1)} dB)`;
                }
            } else if (change.effectType === 'filter' && change.parameter === 'frequency') {
                // Show frequency in Hz or kHz
                const freqValue = change.value;
                displayValue = freqValue >= 1000 ? 
                    `${(freqValue/1000).toFixed(1)} kHz` : 
                    `${Math.round(freqValue)} Hz`;
            } else if (change.parameter === 'wet') {
                // Show wet mix as percentage
                displayValue = `${Math.round(change.value * 100)}%`;
            } else {
                // Default formatting
                displayValue = change.value.toFixed(2);
            }
            
            effectElement.valueElement.textContent = displayValue;
            
            // Update bar fill based on normalized value
            const fillPercent = change.normalized !== undefined ? 
                (change.normalized * 100) : 
                ((change.value - this.parameterRanges?.[change.effectType]?.[change.parameter]?.min || 0) / 
                (this.parameterRanges?.[change.effectType]?.[change.parameter]?.max || 1) * 100);
            
            effectElement.barFill.style.width = `${Math.min(Math.max(0, fillPercent), 100)}%`;
            
            // Add a visual indicator for the hand parameter being used
            effectElement.element.dataset.handParameter = change.handParameter;
        });
    }

    populatePerformanceUI() {
        if (!this.inPerformanceMode) return;
        
        // Move video container from setup to performance
        const setupVideo = document.querySelector('#setup-mode .video-container');
        const performanceVideo = document.querySelector('#performance-mode .video-container');
        
        if (setupVideo && performanceVideo) {
            // Move all children from setup to performance
            while (setupVideo.firstChild) {
                performanceVideo.appendChild(setupVideo.firstChild);
            }
        }
        
        // Sync current audio source button
        this.updatePerformanceSourceButtons(this.appState.audioSource);
        
        // Update play/stop buttons
        this.updatePlayStopButtons(this.audioEngine.playing);
        
        // Update mappings display
        this.updatePerformanceMappingsDisplay();
    }

    async enterPerformanceMode() {
        // Stop any volume tests
        this.stopAllVolumeTests();
        
        // Switch to performance mode
        this.setupModeContainer.classList.remove('active');
        this.performanceModeContainer.classList.add('active');
        this.inPerformanceMode = true;
        
        // Populate the performance UI with current state
        this.populatePerformanceUI();
        
        // Create random mappings based on chaos level
        const chaosSlider = document.getElementById('chaos-level');
        /* @tweakable amount of randomness in effect mappings (0-100) */
        const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
        
        // Store baseline volume before recreating mappings
        /* @tweakable baseline volume level in dB */
        const baselineVolume = this.audioEngine.baselineVolume;
        console.log("Entering performance mode with baseline volume:", baselineVolume);

        // Apply initial dry/wet value from slider
        const dryWetSlider = document.getElementById('dry-wet');
        if (dryWetSlider) {
            const mix = parseInt(dryWetSlider.value) / 100;
            this.audioEngine.setDryWet(mix);
        }
        
        // Ensure audio is ready for performance mode
        try {
            // Make sure the audio context is started explicitly when entering performance mode
            await this.audioEngine.startAudioContext();
            
            // Create new random mappings based on the chaos level
            this.parameterMapper.createRandomMappings(undefined, chaosLevel);
            this.updatePerformanceMappingsDisplay();
            
            // Ensure the baseline volume is preserved after entering performance mode
            this.audioEngine.setBaselineVolume(baselineVolume);
            console.log("After mapping creation, baseline volume:", this.audioEngine.baselineVolume);
            
            // Reconnect all audio nodes to ensure proper routing
            if (this.audioEngine.sourceType) {
                await this.audioEngine.setSource(this.audioEngine.sourceType);
            } else {
                await this.audioEngine.setSource('noise');
            }
            
            // If we were playing in setup mode, make sure we're still playing
            if (this.audioEngine.playing) {
                await this.audioEngine.play();
            }
        } catch (error) {
            console.error("Error initializing audio for performance mode:", error);
        }
    }

    exitPerformanceMode() {
        // Store current audio state
        const wasPlaying = this.audioEngine.playing;
        const currentSource = this.audioEngine.sourceType;
        
        // Move video container back to setup
        const setupVideo = document.querySelector('#setup-mode .video-container');
        const performanceVideo = document.querySelector('#performance-mode .video-container');
        
        if (setupVideo && performanceVideo) {
            // Move all children from performance to setup
            while (performanceVideo.firstChild) {
                setupVideo.appendChild(performanceVideo.firstChild);
            }
        }
        
        // Switch back to setup mode
        this.performanceModeContainer.classList.remove('active');
        this.setupModeContainer.classList.add('active');
        this.inPerformanceMode = false;
        
        // Update buttons
        this.updateSourceButtons(this.appState.audioSource);
        this.updatePlayStopButtons(this.audioEngine.playing);
        
        // Ensure audio keeps playing if it was playing before
        if (wasPlaying) {
            setTimeout(async () => {
                try {
                    await this.audioEngine.startAudioContext();
                    if (currentSource) {
                        await this.audioEngine.setSource(currentSource);
                    }
                    await this.audioEngine.play();
                } catch (error) {
                    console.error("Error restoring audio after exiting performance mode:", error);
                }
            }, 100);
        }
    }

    async nextAudioFileWithFade() {
        if (this.audioEngine.audioFiles.length <= 1) return;
        
        // Fade out current audio
        await this.audioEngine.fadeOut(0.5);
        
        // Switch to next file
        await this.audioEngine.nextAudioFile();
        
        // If we're playing, fade back in
        if (this.audioEngine.playing) {
            this.audioEngine.fadeIn(0.5);
        }
    }

    saveCurrentSettings() {
        const name = prompt('Enter a name for these settings:', '');
        if (name) {
            const saved = this.parameterMapper.saveCurrentSettings(name);
            if (saved) {
                alert(`Settings saved as "${name}"`);
            }
        }
    }

    loadSavedSettingsList() {
        const settings = this.parameterMapper.getSavedSettings();
        // Future implementation for settings UI
    }

    checkDeviceType() {
        const deviceStatus = document.getElementById('device-status');
        if (!deviceStatus) return;
        
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isTablet = /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent);
        
        if (isMobile && !isTablet) {
            deviceStatus.textContent = 'Mobile experience limited - best on desktop/tablet';
        } else if (isTablet) {
            deviceStatus.textContent = 'Optimized for tablet';
        } else {
            deviceStatus.textContent = 'Optimized for desktop';
        }
    }

    async requestPermissions() {
        try {
            // Proactively request camera and microphone permissions
            await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            console.log('Initial permissions granted');
            return true;
        } catch (error) {
            console.error('Initial permission request failed:', error);
            // We'll still continue with app initialization
            // Individual components will handle their own permission requests
            return false;
        }
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new ManosApp();
    app.initialize();
});