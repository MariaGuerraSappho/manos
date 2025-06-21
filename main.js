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
            loop: false,
            baselineVolume: -10
        };

        // UI Elements (video container is shared!)
        this.setupModeContainer = document.getElementById('setup-mode');
        this.performanceModeContainer = document.getElementById('performance-mode');

        // Controls - Setup
        this.noiseButton = document.getElementById('noise-btn');
        this.oscButton = document.getElementById('osc-btn');
        this.micButton = document.getElementById('mic-btn');
        this.fileButton = document.getElementById('file-btn');
        this.fileInput = document.getElementById('audio-upload');
        this.playButton = document.getElementById('play-btn');
        this.stopButton = document.getElementById('stop-btn');
        this.startPerformanceButton = document.getElementById('start-performance-btn');
        this.fileBrowserElement = document.getElementById('file-browser');
        this.fileListElement = document.getElementById('file-list');
        this.micSelect = document.getElementById('mic-select');
        this.outputSelect = document.getElementById('output-select');
        this.activeMappingsElement = document.getElementById('active-mappings');
        this.activeEffectsListElement = document.getElementById('active-effects-list');

        // Controls - Performance
        this.performanceNoiseButton = document.getElementById('performance-noise-btn');
        this.performanceOscButton = document.getElementById('performance-osc-btn');
        this.performanceMicButton = document.getElementById('performance-mic-btn');
        this.performanceFileButton = document.getElementById('performance-file-btn');
        this.performanceRandomizeButton = document.getElementById('performance-randomize-btn');
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

        // Add oscillator feedback element
        this.oscillatorCount = null;
        
        // Add performance monitoring for better responsiveness
        this.performanceStats = {
            lastUpdateTime: 0,
            frameCount: 0,
            frameTimes: [],
            glitchCount: 0,
            isThrottling: false,
            lastThrottleTime: 0,
            audioWorkletActive: false
        };
        
        // Add pause overlay reference
        this.pauseOverlay = null;
        
        this.populatePerformanceUI = this.populatePerformanceUI.bind(this);
    }
    
    async initialize() {
        try {
            console.log('Initializing Manos app...');
            
            // Create pause overlay for clear feedback
            this.createPauseOverlay();
            
            // Initialize audio engine first
            const audioInitialized = await this.audioEngine.initialize();
            console.log('Audio engine initialization:', audioInitialized ? 'success' : 'failed');
            
            // Initialize hand tracker
            const handInitialized = await this.handTracker.initialize();
            console.log('Hand tracker initialization:', handInitialized ? 'success' : 'failed');
            
            if (audioInitialized && handInitialized) {
                this.handTracker.setHandUpdateCallback(this.onHandUpdate.bind(this));
                this.handTracker.setGestureDetectedCallback(this.onGestureDetected.bind(this));
                this.setupEventListeners();
                
                // Apply lower chaos level on low power devices
                if (window.defaultChaosLevel !== undefined) {
                    this.parameterMapper.chaosLevel = window.defaultChaosLevel;
                    
                    // Update the chaos slider to match
                    const chaosSlider = document.getElementById('chaos-level');
                    if (chaosSlider) {
                        chaosSlider.value = Math.round(window.defaultChaosLevel * 100);
                    }
                }
                
                this.parameterMapper.createRandomMappings();
                this.updateMappingsDisplay();
                this.updateActiveEffectsList();
                await this.audioEngine.setSource(this.appState.audioSource);
                this.updateSourceButtons(this.appState.audioSource);
                
                // Make sure saved settings panel exists before trying to use it
                if (document.getElementById('saved-settings-panel')) {
                    this.loadSavedSettingsList();
                }
                
                // Load panel collapsed states
                this.loadPanelCollapsedStates();
                
                // Make sure effect buttons have active state correctly set initially
                this.syncEffectSelection();
                
                // Initialize audio level meter
                this.initializeAudioLevelMeter();
                
                this.initialized = true;
                this.checkDeviceType();
            } else {
                console.error('Failed to initialize core components');
            }
        } catch (error) {
            console.error('Error initializing Manos app:', error);
            alert('An error occurred while initializing the app. Please reload the page.');
        }
    }
    
    createPauseOverlay() {
        // Create pause overlay if it doesn't exist
        if (!document.getElementById('pause-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'pause-overlay';
            overlay.className = 'pause-overlay';
            overlay.innerHTML = '<div class="pause-message">SOUND PAUSED</div>';
            
            // Store reference for later use
            this.pauseOverlay = overlay;
            
            // Add to both video containers
            const setupVideoContainer = document.querySelector('#setup-mode .video-container');
            const performanceVideoContainer = document.querySelector('#performance-mode .video-container');
            
            if (setupVideoContainer) {
                setupVideoContainer.appendChild(overlay.cloneNode(true));
            }
            
            if (performanceVideoContainer) {
                performanceVideoContainer.appendChild(overlay.cloneNode(true));
            }
        }
    }
    
    initializeAudioLevelMeter() {
        // Create an analyzer for monitoring overall audio level
        this.audioAnalyzer = new Tone.Analyser('waveform', 1024);
        this.audioEngine.limiter.connect(this.audioAnalyzer);
        
        // Start a timer to update the meter
        this.audioMeterInterval = setInterval(() => {
            try {
                if (this.audioAnalyzer && this.initialized) {
                    const waveform = this.audioAnalyzer.getValue();
                    let sum = 0;
                    
                    // Calculate RMS of the waveform
                    for (let i = 0; i < waveform.length; i++) {
                        sum += waveform[i] * waveform[i];
                    }
                    
                    // Get the average and calculate the RMS
                    const rms = Math.sqrt(sum / waveform.length);
                    
                    // Scale to a reasonable value (0-100) with higher sensitivity
                    const level = Math.min(100, Math.max(0, rms * 1500 * 100));
                    
                    // Update the audio meter
                    this.updateAudioMeter(level);
                }
            } catch (e) {
                console.warn('Error updating audio meter:', e);
            }
        }, 33); // Update 30 times per second for smoother display
    }
    
    updateAudioMeter(level) {
        // Update volume meter
        const volumeFill = document.querySelector('.volume-fill');
        if (volumeFill) {
            volumeFill.style.width = `${level}%`;
        }
        
        // Check if compressor is active by looking at gain reduction
        // Simulate compression based on input level
        let compressionAmount = 0;
        
        if (level > 70) {
            // High input level, more compression
            compressionAmount = Math.min(100, (level - 70) * 3.3);
        } else if (level > 50) {
            // Medium input level, some compression
            compressionAmount = Math.min(100, (level - 50) * 1.5);
        }
        
        // Update compression meter
        const compressionFill = document.querySelector('.compression-fill');
        if (compressionFill) {
            compressionFill.style.width = `${compressionAmount}%`;
            
            // Add active class for animation when compressing heavily
            if (compressionAmount > 50) {
                compressionFill.classList.add('active');
            } else {
                compressionFill.classList.remove('active');
            }
        }
    }

    setupEventListeners() {
        // Setup Mode
        this.noiseButton?.addEventListener('click', () => this.selectSource('noise'));
        this.oscButton?.addEventListener('click', () => this.selectSource('oscillators'));
        this.micButton?.addEventListener('click', () => {
            this.selectSource('mic');
            // Show microphone meter when mic is selected
            const micMeter = document.querySelector('.mic-meter-container');
            if (micMeter) {
                micMeter.classList.add('active');
                micMeter.classList.remove('hidden');
            }
        });
        this.fileButton?.addEventListener('click', () => {
            // If files already uploaded, switch to file source directly
            if (this.appState.uploadedFiles && this.appState.uploadedFiles.length > 0) {
                this.selectSource('file');
            } else {
                // Otherwise open file picker
                this.fileInput?.click();
            }
        });
        
        // Add pitch control listeners
        const oscillatorPitchSlider = document.getElementById('oscillator-pitch');
        const performanceOscillatorPitchSlider = document.getElementById('performance-oscillator-pitch');
        
        if (oscillatorPitchSlider) {
            oscillatorPitchSlider.addEventListener('input', (e) => {
                const pitchOffset = parseInt(e.target.value);
                const displayEl = e.target.parentNode.querySelector('.pitch-value-display');
                if (displayEl) {
                    displayEl.textContent = `${pitchOffset > 0 ? '+' : ''}${pitchOffset} semitones`;
                }
                
                // Update oscillators if active
                if (this.appState.audioSource === 'oscillators') {
                    const fingerCount = this.audioEngine.activeOscillators || 1;
                    this.audioEngine.updateOscillatorCount(fingerCount, pitchOffset);
                }
            });
        }
        
        if (performanceOscillatorPitchSlider) {
            performanceOscillatorPitchSlider.addEventListener('input', (e) => {
                const pitchOffset = parseInt(e.target.value);
                const displayEl = e.target.parentNode.querySelector('.pitch-value-display');
                if (displayEl) {
                    displayEl.textContent = `${pitchOffset > 0 ? '+' : ''}${pitchOffset} semitones`;
                }
                
                // Update oscillators if active
                if (this.appState.audioSource === 'oscillators') {
                    const fingerCount = this.audioEngine.activeOscillators || 1;
                    this.audioEngine.updateOscillatorCount(fingerCount, pitchOffset);
                }
            });
        }
        
        this.fileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFileUpload(e.target.files);
        });
        this.playButton?.addEventListener('click', async () => {
            await this.audioEngine.startAudioContext();
            this.audioEngine.play();
            this.updatePlayButtonState(true);
        });
        this.stopButton?.addEventListener('click', () => {
            this.stop();
            this.updatePlayButtonState(false);
        });
        
        // Make sure start performance button has an event listener
        if (this.startPerformanceButton) {
            this.startPerformanceButton.addEventListener('click', () => this.enterPerformanceMode());
        }

        // Performance Mode
        this.performanceNoiseButton?.addEventListener('click', () => this.changePerformanceSource('noise'));
        this.performanceOscButton?.addEventListener('click', () => this.changePerformanceSource('oscillators'));
        this.performanceMicButton?.addEventListener('click', () => {
            this.changePerformanceSource('mic');
            // Show microphone meter when mic is selected in performance mode
            const micMeter = document.querySelector('.performance-mic-meter-container');
            if (micMeter) {
                micMeter.classList.add('active');
                micMeter.classList.remove('hidden');
            }
        });
        this.performanceFileButton?.addEventListener('click', () => this.changePerformanceSource('file'));
        
        // Add event listeners for enhanced play/stop buttons
        const enhancedPlayBtn = document.getElementById('enhanced-play-btn');
        const enhancedStopBtn = document.getElementById('enhanced-stop-btn');
        
        if (enhancedPlayBtn) {
            enhancedPlayBtn.addEventListener('click', async () => {
                await this.audioEngine.startAudioContext();
                this.audioEngine.play();
                this.updatePlayButtonState(true);
            });
        }
        
        if (enhancedStopBtn) {
            enhancedStopBtn.addEventListener('click', () => {
                this.stop();
                this.updatePlayButtonState(false);
            });
        }

        // Move randomize button handler to handle both buttons
        const performanceRandomizeButtons = document.querySelectorAll('#performance-randomize-btn');
        performanceRandomizeButtons.forEach(button => {
            button.addEventListener('click', async () => {
                // Check if audio is playing before randomizing
                const wasPlaying = this.audioEngine.playing;
                
                // Get chaos level from slider
                const chaosSlider = document.getElementById('chaos-level');
                const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                
                // Get currently selected effects from the quick panel buttons
                const selectedEffects = Array.from(
                    document.querySelectorAll('.effect-quick-btn.active')
                ).map(btn => btn.dataset.effect);
                
                // Update the parameter mapper with only the active effects
                this.parameterMapper.setSelectedEffects(selectedEffects);
                
                // Create random mappings with only the selected effects
                this.parameterMapper.createRandomMappings(undefined, chaosLevel);
                this.updatePerformanceMappingsDisplay();
                
                // Resume playback if it was playing before randomization
                if (wasPlaying && !this.audioEngine.playing) {
                    await this.audioEngine.startAudioContext();
                    await this.audioEngine.play();
                    this.updatePlayButtonState(true);
                }
            });
        });
        
        this.performanceSaveButton?.addEventListener('click', () => {
            this.saveCurrentSettings();
        });
        this.performanceNextFileButton?.addEventListener('click', () => {
            this.nextAudioFileWithFade();
        });
        
        // Add exit performance button event listener with null check
        if (this.exitPerformanceButton) {
            this.exitPerformanceButton.addEventListener('click', () => this.exitPerformanceMode());
        } else {
            console.error('Exit performance button not found in the DOM');
        }
        
        // Chaos level handler
        const chaosSlider = document.getElementById('chaos-level');
        if (chaosSlider) {
            chaosSlider.addEventListener('input', (e) => {
                const chaosLevel = parseInt(e.target.value) / 100;
                this.parameterMapper.setChaosLevel(chaosLevel);
            });
        }
        
        if (this.performanceRandomizeButton) {
            this.performanceRandomizeButton.addEventListener('click', async () => {
                // Check if audio is playing before randomizing
                const wasPlaying = this.audioEngine.playing;
                
                // Get chaos level from slider
                const chaosSlider = document.getElementById('chaos-level');
                const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                
                // Make sure we're using the latest effect selection
                this.updateSelectedEffects();
                
                this.parameterMapper.createRandomMappings(undefined, chaosLevel);
                this.updatePerformanceMappingsDisplay();
                
                // Resume playback if it was playing before randomization
                if (wasPlaying && !this.audioEngine.playing) {
                    await this.audioEngine.startAudioContext();
                    await this.audioEngine.play();
                    this.updatePlayButtonState(true);
                }
            });
        }
        
        if (this.performanceSaveButton) {
            this.performanceSaveButton.addEventListener('click', () => {
                this.saveCurrentSettings();
            });
        }
        
        if (this.performanceNextFileButton) {
            this.performanceNextFileButton.addEventListener('click', () => {
                this.nextAudioFileWithFade();
            });
        }
        
        // Add panel customization button handler
        const customizePanelsBtn = document.getElementById('customize-panels-btn');
        if (customizePanelsBtn) {
            customizePanelsBtn.addEventListener('click', () => {
                this.showPanelCustomizer();
            });
        }
        
        // Add close panel customizer button handler
        const closePanelCustomizerBtn = document.getElementById('close-panel-customizer');
        if (closePanelCustomizerBtn) {
            closePanelCustomizerBtn.addEventListener('click', () => {
                this.hidePanelCustomizer();
                this.savePanelSettings();
            });
        }
        
        // Add panel toggle handlers
        document.querySelectorAll('.panel-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const panelId = e.target.id.replace('toggle-', '');
                this.togglePanel(panelId, e.target.checked);
            });
        });
        
        // Load saved panel settings
        this.loadPanelSettings();
        
        // Load Settings button handler
        const performanceLoadButton = document.getElementById('performance-load-btn');
        if (performanceLoadButton) {
            performanceLoadButton.addEventListener('click', () => {
                this.showSavedSettingsPanel();
            });
        }
        
        // Close saved settings panel button handler
        const closeSavedSettingsButton = document.getElementById('close-saved-settings');
        if (closeSavedSettingsButton) {
            closeSavedSettingsButton.addEventListener('click', () => {
                this.hideSavedSettingsPanel();
            });
        }
        
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
        
        // Effect selection handlers
        document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                // Update the selected effects in the parameter mapper
                this.updateSelectedEffects();
            });
        });
        
        const selectAllEffectsBtn = document.getElementById('select-all-effects');
        const deselectAllEffectsBtn = document.getElementById('deselect-all-effects');
        
        if (selectAllEffectsBtn) {
            selectAllEffectsBtn.addEventListener('click', () => {
                document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
                    checkbox.checked = true;
                });
                this.updateSelectedEffects();
            });
        }
        
        if (deselectAllEffectsBtn) {
            deselectAllEffectsBtn.addEventListener('click', () => {
                document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
                    checkbox.checked = false;
                });
                this.updateSelectedEffects();
            });
        }
        
        // Add compressor control handlers
        const thresholdSlider = document.getElementById('compressor-threshold');
        const ratioSlider = document.getElementById('compressor-ratio');
        const attackSlider = document.getElementById('compressor-attack');
        const releaseSlider = document.getElementById('compressor-release');
        
        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.audioEngine.setEffectParameter('compressor', 'threshold', value);
                document.getElementById('threshold-value').textContent = `${value} dB`;
            });
        }
        
        if (ratioSlider) {
            ratioSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.audioEngine.setEffectParameter('compressor', 'ratio', value);
                document.getElementById('ratio-value').textContent = `${value}:1`;
            });
        }
        
        if (attackSlider) {
            attackSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 1000; // Convert to seconds
                this.audioEngine.setEffectParameter('compressor', 'attack', value);
                document.getElementById('attack-value').textContent = `${parseInt(e.target.value)} ms`;
            });
        }
        
        if (releaseSlider) {
            releaseSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 1000; // Convert to seconds
                this.audioEngine.setEffectParameter('compressor', 'release', value);
                document.getElementById('release-value').textContent = `${parseInt(e.target.value)} ms`;
            });
        }
        
        // Add dry/wet mixer handler
        const dryWetSlider = document.getElementById('drywet-level');
        if (dryWetSlider) {
            dryWetSlider.addEventListener('input', (e) => {
                const wetPercentage = parseInt(e.target.value) / 100;
                this.audioEngine.setDryWetMix(wetPercentage);
                
                // Update the display text
                const dryWetValue = document.getElementById('drywet-value');
                if (dryWetValue) {
                    dryWetValue.textContent = `${e.target.value}% Wet`;
                }
            });
        }
        
        // Add master volume control
        const masterVolumeSlider = document.getElementById('master-volume');
        const masterVolumeValue = document.querySelector('.master-volume-value');
        
        if (masterVolumeSlider) {
            masterVolumeSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.audioEngine.setMasterVolume(value);
                if (masterVolumeValue) {
                    masterVolumeValue.textContent = `${value} dB`;
                }
                
                // If master volume is very low, ensure no sound plays
                if (value <= -40) {
                    this.audioEngine.stop();
                    this.updatePlayButtonState(false);
                    this.showPauseOverlay(true);
                } else if (this.audioEngine.playing === false && value > -40) {
                    // Check if we should be playing but were muted
                    this.audioEngine.play();
                    this.updatePlayButtonState(true);
                    this.showPauseOverlay(false);
                }
            });
        }
        
        // Add collapsible panel functionality for dry/wet control
        document.querySelectorAll('.drywet-control h3').forEach(heading => {
            heading.addEventListener('click', (e) => {
                const panel = e.target.closest('.drywet-control');
                panel.classList.toggle('collapsed');
                
                // Save collapsed state to localStorage
                this.savePanelCollapsedState('drywet', panel.classList.contains('collapsed'));
            });
        });
        
        // Add collapsible panels functionality
        document.querySelectorAll('.compressor-controls h3, .effect-selection-container h3').forEach(heading => {
            heading.addEventListener('click', (e) => {
                const panel = e.target.closest('.compressor-controls, .effect-selection-container');
                panel.classList.toggle('collapsed');
                
                // Save collapsed state to localStorage
                const panelType = panel.classList.contains('compressor-controls') ? 'compressor' : 'effect-selection';
                this.savePanelCollapsedState(panelType, panel.classList.contains('collapsed'));
            });
        });
        
        // Make sure panels are expanded by default on first load
        setTimeout(() => {
            document.querySelectorAll('.compressor-controls, .effect-selection-container').forEach(panel => {
                if (!localStorage.getItem('manos-panel-collapsed')) {
                    panel.classList.remove('collapsed');
                }
            });
        }, 500);
        
        // Add event listeners for effect quick selection buttons - CRITICAL FIX
        document.querySelectorAll('.effect-quick-btn').forEach(button => {
            // Remove any existing listeners to prevent duplicates
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Make all buttons active by default
            newButton.classList.add('active');
            
            // Add fresh click handler to toggle active state
            newButton.addEventListener('click', () => {
                newButton.classList.toggle('active');
                console.log(`Effect ${newButton.dataset.effect} toggled: ${newButton.classList.contains('active')}`);
                
                // Get the app instance if available
                const appInstance = window.manosApp;
                if (appInstance && appInstance.updateSelectedEffects) {
                    appInstance.updateSelectedEffects();
                    // Immediately apply the effect selection
                    const chaosSlider = document.getElementById('chaos-level');
                    const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                    appInstance.parameterMapper.createRandomMappings(undefined, chaosLevel);
                    appInstance.updatePerformanceMappingsDisplay();
                }
            });
        });
        
        // Remove event listeners for the removed buttons
        const applyQuickEffectsBtn = document.getElementById('apply-quick-effects-btn');
        if (applyQuickEffectsBtn) {
            applyQuickEffectsBtn.addEventListener('click', () => {
                // Get all selected effects from the quick panel
                const selectedEffects = Array.from(
                    document.querySelectorAll('.effect-quick-btn.active')
                ).map(btn => btn.dataset.effect);
                
                console.log('Applying selected effects:', selectedEffects);
                
                // Update checkboxes in the full effect panel to match
                document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
                    checkbox.checked = selectedEffects.includes(checkbox.dataset.effect);
                });
                
                // Update the parameter mapper with selected effects
                this.parameterMapper.setSelectedEffects(selectedEffects);
                
                // Create new random mappings with only the selected effects
                const chaosSlider = document.getElementById('chaos-level');
                const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                this.parameterMapper.createRandomMappings(undefined, chaosLevel);
                
                // Update mappings display
                this.updatePerformanceMappingsDisplay();
                
                // Show feedback
                this.showQuickSelectFeedback(`Applied ${selectedEffects.length} effect${selectedEffects.length !== 1 ? 's' : ''}`);
            });
        }

        // Clear all quick effects button
        const clearQuickEffectsBtn = document.getElementById('clear-quick-effects-btn');
        if (clearQuickEffectsBtn) {
            clearQuickEffectsBtn.addEventListener('click', () => {
                document.querySelectorAll('.effect-quick-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                this.showQuickSelectFeedback('All effects cleared');
            });
        }

        // Toggle quick panel visibility
        const toggleQuickPanelBtn = document.getElementById('toggle-quick-panel-btn');
        if (toggleQuickPanelBtn) {
            toggleQuickPanelBtn.addEventListener('click', () => {
                const panel = document.querySelector('.effect-quick-select-overlay');
                if (panel) {
                    if (panel.classList.contains('minimized')) {
                        panel.classList.remove('minimized');
                        toggleQuickPanelBtn.textContent = 'Hide';
                    } else {
                        panel.classList.add('minimized');
                        toggleQuickPanelBtn.textContent = 'Show';
                    }
                }
            });
        }
    }

    // Setup: File upload
    async handleFileUpload(fileList) {
        const audioFiles = Array.from(fileList).filter(f => f.type.startsWith('audio/') ||
            f.name.endsWith('.mp3') || f.name.endsWith('.wav') ||
            f.name.endsWith('.ogg') || f.name.endsWith('.aac') || f.name.endsWith('.m4a')
        );
        if (!audioFiles.length) {
            alert('No audio files found.');
            return;
        }
        await this.audioEngine.startAudioContext();
        const success = await this.audioEngine.loadAudioFiles(audioFiles);
        if (success) {
            this.appState.uploadedFiles = audioFiles;
            this.updateSourceButtons('file');
            
            // Show/hide file browser as needed
            if (this.appState.audioSource === 'file') {
                this.updateFileBrowser();
                this.fileBrowserElement.classList.remove('hidden');
            } else {
                this.fileBrowserElement.classList.add('hidden');
            }
            
            // Show/hide oscillator count display
            this.toggleOscillatorCountDisplay(this.appState.audioSource === 'oscillators');
            
            // Auto-play when pink noise or oscillators are selected
            if (this.appState.audioSource === 'noise' || this.appState.audioSource === 'oscillators') {
                await this.audioEngine.play();
                this.updatePlayButtonState(true);
                
                // If oscillators, update the initial count
                if (this.appState.audioSource === 'oscillators') {
                    this.audioEngine.updateOscillatorCount(1);
                }
            }
            
            // Update current file display if needed
            if (this.appState.audioSource === 'file') {
                this.updateCurrentFileDisplay();
            }
        }
    }

    // Source selection: Setup
    async selectSource(sourceType) {
        await this.audioEngine.startAudioContext();
        const ok = await this.audioEngine.setSource(sourceType);
        if (ok) {
            this.appState.audioSource = sourceType;
            this.updateSourceButtons(sourceType);
            
            // Show/hide file browser as needed
            if (sourceType === 'file') {
                this.updateFileBrowser();
                this.fileBrowserElement.classList.remove('hidden');
            } else {
                this.fileBrowserElement.classList.add('hidden');
            }
            
            // Show/hide oscillator controls and count display
            const oscillatorControls = document.getElementById('oscillator-controls');
            if (oscillatorControls) {
                oscillatorControls.classList.toggle('hidden', sourceType !== 'oscillators');
            }
            this.toggleOscillatorCountDisplay(sourceType === 'oscillators');
            
            // Auto-play when pink noise or oscillators are selected
            if (sourceType === 'noise' || sourceType === 'oscillators') {
                await this.audioEngine.play();
                this.updatePlayButtonState(true);
                
                // If oscillators, update with current pitch
                if (sourceType === 'oscillators') {
                    // Get pitch value if oscillator mode
                    const pitchSlider = document.getElementById('oscillator-pitch');
                    const pitchOffset = pitchSlider ? parseInt(pitchSlider.value) : 0;
                    this.audioEngine.updateOscillatorCount(1, pitchOffset);
                }
            }
            
            // Update current file display if needed
            if (sourceType === 'file') {
                this.updateCurrentFileDisplay();
            }
        }
    }

    // Source selection: Performance
    async changePerformanceSource(sourceType) {
        await this.audioEngine.startAudioContext();
        // Only allow file source if user uploaded files during setup
        if (sourceType === 'file' && (!this.appState.uploadedFiles || !this.appState.uploadedFiles.length)) {
            alert('No audio files uploaded. Please upload files in setup mode first.');
            return;
        }
        const ok = await this.audioEngine.setSource(sourceType);
        if (!ok) return;
        
        this.appState.audioSource = sourceType;
        this.updatePerformanceSourceButtons(sourceType);
        this.updateCurrentFileDisplay();
        this.populatePerformanceUI();
        
        // Show/hide oscillator controls and count display
        const performanceOscillatorControls = document.getElementById('performance-oscillator-controls');
        if (performanceOscillatorControls) {
            performanceOscillatorControls.classList.toggle('hidden', sourceType !== 'oscillators');
        }
        this.toggleOscillatorCountDisplay(sourceType === 'oscillators');
        
        // Auto-play when pink noise or oscillillators are selected
        if (sourceType === 'noise' || sourceType === 'oscillators') {
            await this.audioEngine.play();
            this.updatePlayButtonState(true);
            
            // If oscillators, update with current pitch
            if (sourceType === 'oscillators') {
                // Get pitch value if oscillator mode
                const pitchSlider = document.getElementById('performance-oscillator-pitch');
                const pitchOffset = pitchSlider ? parseInt(pitchSlider.value) : 0;
                this.audioEngine.updateOscillatorCount(1, pitchOffset);
            }
        }
        
        // Auto-play when file is selected
        if (sourceType === 'file') {
            await this.audioEngine.play();
            this.updatePlayButtonState(true);
        }
        
        // Hide mic meter if not using mic
        if (sourceType !== 'mic') {
            document.querySelector('.performance-mic-meter-container')?.classList.add('hidden');
            document.querySelector('.performance-mic-meter-container')?.classList.remove('active');
        }
    }
    
    // New method to toggle oscillator count display
    toggleOscillatorCountDisplay(show) {
        if (this.oscillatorCount) {
            if (show) {
                this.oscillatorCount.classList.add('active');
            } else {
                this.oscillatorCount.classList.remove('active');
            }
        }
    }

    // Switch modes: Setup 
    enterPerformanceMode() {
        if (!this.setupModeContainer || !this.performanceModeContainer) {
            console.error('Setup or performance containers not found');
            return;
        }
        
        this.inPerformanceMode = true;
        
        // Add performance mode class to body
        document.body.classList.add('performance-mode');
        
        // Move video elements to performance mode
        const setupVideoContainer = document.querySelector('#setup-mode .video-container');
        const performanceVideoContainer = document.querySelector('#performance-mode .video-container');
        
        if (!setupVideoContainer || !performanceVideoContainer) {
            console.error('Video containers not found');
            return;
        }
        
        // First, ensure the performance container is empty except for the randomize button overlay
        const randomizeOverlay = performanceVideoContainer.querySelector('.performance-randomize-btn-overlay');
        
        while (performanceVideoContainer.firstChild) {
            if (performanceVideoContainer.firstChild !== randomizeOverlay) {
                performanceVideoContainer.removeChild(performanceVideoContainer.firstChild);
            } else {
                break;
            }
        }
        
        // Save a reference to all video container children
        const videoElements = [];
        while (setupVideoContainer.firstChild) {
            videoElements.push(setupVideoContainer.removeChild(setupVideoContainer.firstChild));
        }
        
        // Add all elements to performance container before the randomize button overlay
        if (randomizeOverlay) {
            videoElements.forEach(element => {
                performanceVideoContainer.insertBefore(element, randomizeOverlay);
            });
        } else {
            videoElements.forEach(element => {
                performanceVideoContainer.appendChild(element);
            });
        }
        
        // Hide setup, show performance
        this.setupModeContainer.classList.remove('active');
        this.performanceModeContainer.classList.add('active');
        this.populatePerformanceUI();
        
        // Make sure the performance-effects-header is visible when entering performance mode
        const performanceEffectsHeader = document.querySelector('.performance-effects-header');
        if (performanceEffectsHeader) {
            performanceEffectsHeader.classList.remove('hidden');
        }
    }
    
    exitPerformanceMode() {
        if (!this.setupModeContainer || !this.performanceModeContainer) {
            console.error('Setup or performance containers not found');
            return;
        }
        
        this.inPerformanceMode = false;
        
        // Remove performance mode class from body
        document.body.classList.remove('performance-mode');
        
        // Move video elements back to setup mode
        const setupVideoContainer = document.querySelector('#setup-mode .video-container');
        const performanceVideoContainer = document.querySelector('#performance-mode .video-container');
        
        if (!setupVideoContainer || !performanceVideoContainer) {
            console.error('Video containers not found');
            return;
        }
        
        // Save a reference to all video container children
        const videoElements = [];
        while (performanceVideoContainer.firstChild) {
            videoElements.push(performanceVideoContainer.removeChild(performanceVideoContainer.firstChild));
        }
        
        // Add all elements back to setup container
        videoElements.forEach(element => {
            setupVideoContainer.appendChild(element);
        });
        
        // Hide performance, show setup
        this.performanceModeContainer.classList.remove('active');
        this.setupModeContainer.classList.add('active');
    }

    populatePerformanceUI() {
        this.updatePerformanceSourceButtons(this.appState.audioSource);
        if (this.appState.audioSource === 'file') this.updateCurrentFileDisplay();
        this.updatePerformanceMappingsDisplay();
        this.updatePerformanceActiveEffects();
        
        // Sync effect quick select panel with checkboxes
        this.syncEffectSelection();
        
        // Update effect checkboxes based on what's currently selected in the parameter mapper
        const selectedEffects = this.parameterMapper.getSelectedEffects();
        document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
            checkbox.checked = selectedEffects.includes(checkbox.dataset.effect);
        });
    }

    updateCurrentFileDisplay() {
        // Get current file info
        const files = this.audioEngine.getAudioFileList();
        const currentFile = files.find(f => f.isCurrent);

        // Update or create current file display
        let fileDisplay = document.querySelector('.current-file-display');
        const fileControlsContainer = document.getElementById('performance-file-controls');
        
        if (!fileDisplay) {
            fileDisplay = document.createElement('div');
            fileDisplay.className = 'current-file-display';
            if (fileControlsContainer) {
                fileControlsContainer.parentNode.insertBefore(fileDisplay, fileControlsContainer);
            }
        }
        
        if (fileDisplay) {
            if (currentFile) {
                fileDisplay.innerHTML = `<span class="playing-indicator">▶</span> Now Playing: <strong>${currentFile.name}</strong>`;
                fileDisplay.classList.add('playing');
            } else {
                fileDisplay.textContent = 'No file selected';
                fileDisplay.classList.remove('playing');
            }
            fileDisplay.style.display = this.appState.audioSource === 'file' ? 'block' : 'none';
        }
        
        // Also update the file browser in setup mode
        if (!this.inPerformanceMode) {
            this.updateFileBrowser();
        }
    }

    async nextAudioFileWithFade() {
        if (this.appState.audioSource !== 'file' || !this.audioEngine.audioFiles.length) return;
        try {
            const wasFadedOut = await this.audioEngine.fadeOut(1);
            await this.audioEngine.nextAudioFile();
            if (wasFadedOut) {
                await this.audioEngine.play();
                this.audioEngine.fadeIn(1);
            }
            if (!this.inPerformanceMode) this.updateFileBrowser();
            else this.updateCurrentFileDisplay();
        } catch (error) {
            console.error('Error switching audio files:', error);
            alert('There was an error switching audio files. Please try again.');
        }
    }

    async loadCurrentFile() {
        if (this.audioFiles.length === 0) return Promise.resolve(false);
        
        try {
            // Ensure audio context is started
            await this.startAudioContext();
            
            // Create a new player for the current file
            this.player = new Tone.Player({
                fadeIn: 0.05,    // Prevent clicks
                fadeOut: 0.05,   // Prevent clicks
                volume: -10,     // Start at a reasonable volume
                loop: true       // Set player to loop by default
            });
            
            // Get current file
            const currentFile = this.audioFiles[this.currentFileIndex];
            
            // Create AudioBuffer from the ArrayBuffer
            const arrayBuffer = currentFile.buffer;
            
            // Create AudioBuffer from the ArrayBuffer
            const audioContext = Tone.context;
            try {
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                
                // Set the buffer on the player
                this.player.buffer = audioBuffer;
                
                return Promise.resolve(true);
            } catch (decodeError) {
                console.error('Error decoding audio data:', decodeError);
                alert(`Error loading audio file: ${currentFile.name}. The file may be corrupted or in an unsupported format.`);
                return Promise.resolve(false);
            }
        } catch (error) {
            console.error('Error loading current audio file:', error);
            return Promise.resolve(false);
        }
    }

    // --- UI updates below ---
    saveCurrentSettings() {
        const name = prompt('Enter a name for this setting:', `Setting ${new Date().toLocaleTimeString()}`);
        if (name) {
            const saved = this.parameterMapper.saveCurrentSettings(name);
            if (saved) {
                alert(`Setting "${name}" saved successfully!`);
                // Refresh the saved settings list if panel is open
                if (!document.getElementById('saved-settings-panel').classList.contains('hidden')) {
                    this.populateSavedSettingsList();
                }
            }
        }
    }
    updateMappingsDisplay() {
        const mappings = this.parameterMapper.getMappingsDescription();
        this.activeMappingsElement.innerHTML = '';
        mappings.forEach(m => {
            const el = document.createElement('div');
            el.textContent = m.text;
            this.activeMappingsElement.appendChild(el);
        });
    }
    updatePerformanceMappingsDisplay() {
        const mappings = this.parameterMapper.getMappingsDescription();
        
        // Update the header performance effects list
        const headerEffectsList = document.querySelector('.performance-effects-header .performance-effects-list');
        if (headerEffectsList) {
            headerEffectsList.innerHTML = '';
            
            if (mappings.length === 0) {
                const noMappingsEl = document.createElement('div');
                noMappingsEl.className = 'no-mappings';
                noMappingsEl.textContent = 'No effect mappings defined';
                headerEffectsList.appendChild(noMappingsEl);
            } else {
                mappings.forEach(m => {
                    const el = document.createElement('div');
                    el.className = 'effect-item';
                    el.textContent = m.text;
                    headerEffectsList.appendChild(el);
                });
            }
            
            // Ensure the header is visible
            const performanceEffectsHeader = document.querySelector('.performance-effects-header');
            if (performanceEffectsHeader) {
                performanceEffectsHeader.classList.remove('hidden');
            }
        }
        
        // Also update the panel performance effects list for compatibility
        const performanceEffectsDisplay = document.querySelector('.performance-effects-display');
        
        // Check if we have a container for the effects list
        let performanceEffectsList = document.querySelector('.performance-effects-display .performance-effects-list');
        if (!performanceEffectsList && performanceEffectsDisplay) {
            // Create the container if it doesn't exist
            performanceEffectsList = document.createElement('div');
            performanceEffectsList.className = 'performance-effects-list';
            performanceEffectsDisplay.appendChild(performanceEffectsList);
        }
        
        // If the DOM element exists, update it with the mappings
        if (performanceEffectsList) {
            performanceEffectsList.innerHTML = '';
            
            if (mappings.length === 0) {
                const noMappingsEl = document.createElement('div');
                noMappingsEl.className = 'no-mappings';
                noMappingsEl.textContent = 'No effect mappings defined';
                performanceEffectsList.appendChild(noMappingsEl);
            } else {
                mappings.forEach(m => {
                    const el = document.createElement('div');
                    el.className = 'effect-item';
                    el.textContent = m.text;
                    performanceEffectsList.appendChild(el);
                });
            }
        }
        
        // Also update the legacy mappings display if it exists
        if (this.performanceActiveMappingsElement) {
            this.performanceActiveMappingsElement.innerHTML = '';
            mappings.forEach(m => {
                const el = document.createElement('div');
                el.textContent = m.text;
                this.performanceActiveMappingsElement.appendChild(el);
            });
        }
    }
    updateActiveEffectsList() {
        const mappings = this.parameterMapper.getMappingsDescription();
        this.activeEffectsListElement.innerHTML = '';
        mappings.forEach(m => {
            const el = document.createElement('div');
            el.textContent = m.text;
            this.activeEffectsListElement.appendChild(el);
        });
    }
    loadSavedSettingsList() {
        // This method was incomplete - properly implementing it now
        const savedSettings = this.parameterMapper.getSavedSettings();
        // Will be populated when showing the panel
    }
    showSavedSettingsPanel() {
        const panel = document.getElementById('saved-settings-panel');
        if (panel) {
            this.populateSavedSettingsList();
            panel.classList.remove('hidden');
        }
    }
    hideSavedSettingsPanel() {
        const panel = document.getElementById('saved-settings-panel');
        if (panel) {
            panel.classList.add('hidden');
        }
    }
    populateSavedSettingsList() {
        const savedSettings = this.parameterMapper.getSavedSettings();
        const listElement = document.getElementById('saved-settings-list');
        
        if (!listElement) return;
        
        // Clear existing list
        listElement.innerHTML = '';
        
        if (savedSettings.length === 0) {
            const noSettings = document.createElement('div');
            noSettings.className = 'no-settings';
            noSettings.textContent = 'No saved settings found';
            listElement.appendChild(noSettings);
            return;
        }
        
        // Add each saved setting to the list
        savedSettings.forEach(setting => {
            const item = document.createElement('div');
            item.className = 'saved-setting-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'saved-setting-name';
            nameSpan.textContent = setting.name;
            
            const deleteButton = document.createElement('button');
            deleteButton.className = 'saved-setting-delete';
            deleteButton.innerHTML = '&times;';
            deleteButton.title = 'Delete this setting';
            
            item.appendChild(nameSpan);
            item.appendChild(deleteButton);
            listElement.appendChild(item);
            
            // Add click handler to load this setting
            nameSpan.addEventListener('click', () => {
                this.loadSavedSetting(setting.id);
            });
            
            // Add click handler to delete this setting
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete "${setting.name}"?`)) {
                    this.deleteSavedSetting(setting.id);
                }
            });
        });
    }
    loadSavedSetting(settingId) {
        const success = this.parameterMapper.loadSavedSettings(settingId);
        if (success) {
            this.updatePerformanceMappingsDisplay();
            this.hideSavedSettingsPanel();
            alert('Setting loaded successfully!');
        } else {
            alert('Failed to load setting.');
        }
    }
    deleteSavedSetting(settingId) {
        const success = this.parameterMapper.deleteSavedSetting(settingId);
        if (success) {
            this.populateSavedSettingsList();
        }
    }
    onHandUpdate(handData) {
        // Monitor performance before processing
        this.monitorPerformance();
        
        // Apply smoother handling for pitch shift effect specifically
        if (handData && this.parameterMapper.mappings.some(m => m.effectType === 'pitchShift')) {
            // Get height parameter which is commonly mapped to pitch
            const height = handData.height;
            
            // Apply additional smoothing specifically for pitch shift
            if (!this.pitchSmoothValue) this.pitchSmoothValue = height;
            this.pitchSmoothValue = this.pitchSmoothValue * 0.85 + height * 0.15;
            
            // Replace height value with smoother version for pitch shifting
            handData.pitchHeight = this.pitchSmoothValue;
            
            // Add new mapping if needed to use smoother height value
            const pitchMapping = this.parameterMapper.mappings.find(m => 
                m.effectType === 'pitchShift' && m.effectParameter === 'pitch' && m.handParameter === 'height');
            if (pitchMapping) {
                pitchMapping.handParameter = 'pitchHeight';
            }
        }
        
        try {
            this.parameterMapper.processHandData(handData);
        } catch (error) {
            console.error("Error processing hand data:", error);
            // Recover from errors by throttling effects
            this.throttleEffects();
        }
        
        // Update oscillator count if using oscillators
        if (handData && this.appState.audioSource === 'oscillators') {
            const fingerCount = handData.fingers.count;
            
            // Get pitch offset from active slider based on mode
            const pitchSlider = this.inPerformanceMode ? 
                document.getElementById('performance-oscillator-pitch') : 
                document.getElementById('oscillator-pitch');
            const pitchOffset = pitchSlider ? parseInt(pitchSlider.value) : 0;
            
            // Update oscillator count in audio engine - only when it changes
            if (fingerCount !== this.audioEngine.activeOscillators) {
                this.audioEngine.updateOscillatorCount(fingerCount, pitchOffset);
            }
            
            // Update oscillator count display
            if (this.oscillatorCount) {
                this.oscillatorCount.textContent = `Oscillators: ${fingerCount}`;
                this.oscillatorCount.classList.add('active');
                
                // Show names of the extended fingers
                if (fingerCount > 0) {
                    const fingerNames = handData.fingers.extended.join(', ');
                    this.oscillatorCount.textContent += ` (${fingerNames})`;
                }
            } else if (this.oscillatorCount && this.appState.audioSource !== 'oscillators') {
                // Hide oscillator count when not in oscillator mode
                this.oscillatorCount.classList.remove('active');
            }
            
            // Update volume test status in setup mode
            if (!this.inPerformanceMode && handData) {
                const volumeTestStatus = document.getElementById('volume-test-status');
                if (volumeTestStatus) {
                    volumeTestStatus.textContent = 'Volume control active - move hand closer/further to test';
                    volumeTestStatus.classList.add('testing');
                    
                    // Show proximity value for better volume testing
                    const proximity = handData.proximity;
                    const volumeDisplay = document.getElementById('volume-display');
                    if (volumeDisplay) {
                        const baselineVolume = this.appState.baselineVolume;
                        const volumeOffset = Math.round((proximity * 30) - 20); // Maps 0-1 to -20 to +10
                        volumeDisplay.textContent = `${baselineVolume} dB (${volumeOffset > 0 ? '+' : ''}${volumeOffset} dB)`;
                    }
                }
            }
        }
    }
    onGestureDetected(gesture) {
        // Not used, but can be extended
    }
    checkDeviceType() {
        const deviceStatusElement = document.getElementById('device-status');
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isIPad = /iPad/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (deviceStatusElement) {
            if (isIPad) deviceStatusElement.textContent = 'Optimized for iPad';
            else if (isMobile) deviceStatusElement.textContent = 'Mobile device detected';
            else deviceStatusElement.textContent = 'Desktop mode';
        }
        
        // Update layout for small screens
        this.updateLayoutForScreenSize();
    }

    updateLayoutForScreenSize() {
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;
        
        // Adjust panel heights and content based on screen size
        if (windowHeight < 700) {
            // For very small heights, adjust maximum heights
            document.documentElement.style.setProperty('--panel-max-height', (windowHeight - 200) + 'px');
        } else {
            document.documentElement.style.setProperty('--panel-max-height', 'calc(100vh - 200px)');
        }
        
        // Adjust panel widths for small screens
        if (windowWidth < 600) {
            document.documentElement.style.setProperty('--panel-min-width', '200px');
        } else {
            document.documentElement.style.setProperty('--panel-min-width', '300px');
        }
    }
    
    updateSourceButtons(activeSource) {
        this.noiseButton?.classList.toggle('active', activeSource === 'noise');
        this.oscButton?.classList.toggle('active', activeSource === 'oscillators');
        this.micButton?.classList.toggle('active', activeSource === 'mic');
        this.fileButton?.classList.toggle('active', activeSource === 'file');
        
        // Add additional visual feedback about current source
        const sourceDisplayEl = document.createElement('div');
        sourceDisplayEl.className = 'current-source-display';
        sourceDisplayEl.textContent = `Current Source: ${activeSource.charAt(0).toUpperCase() + activeSource.slice(1)}`;
        
        // Remove any existing source display
        const existingDisplay = document.querySelector('.current-source-display');
        if (existingDisplay) existingDisplay.remove();
        
        // Add to both setup and performance modes
        const setupControls = document.querySelector('.source-controls');
        const performanceControls = document.querySelector('.performance-source-controls');
        
        if (this.inPerformanceMode && performanceControls) {
            performanceControls.prepend(sourceDisplayEl.cloneNode(true));
        } else if (setupControls) {
            setupControls.prepend(sourceDisplayEl);
        }
    }
    updatePerformanceSourceButtons(activeSource) {
        this.performanceNoiseButton?.classList.toggle('active', activeSource === 'noise');
        this.performanceOscButton?.classList.toggle('active', activeSource === 'oscillators');
        this.performanceMicButton?.classList.toggle('active', activeSource === 'mic');
        this.performanceFileButton?.classList.toggle('active', activeSource === 'file');
        
        // Additional visual feedback in performance mode
        const sourceDisplayEl = document.querySelector('.performance-source-controls .current-source-display');
        if (sourceDisplayEl) {
            sourceDisplayEl.textContent = `Current Source: ${activeSource.charAt(0).toUpperCase() + activeSource.slice(1)}`;
        } else {
            const newDisplayEl = document.createElement('div');
            newDisplayEl.className = 'current-source-display';
            newDisplayEl.textContent = `Current Source: ${activeSource.charAt(0).toUpperCase() + activeSource.slice(1)}`;
            
            const performanceControls = document.querySelector('.performance-source-controls');
            if (performanceControls) {
                performanceControls.prepend(newDisplayEl);
            }
        }
    }
    updateFileBrowser() {
        const files = this.audioEngine.getAudioFileList();
        if (!this.fileListElement) return;
        
        this.fileListElement.innerHTML = '';
        if (!files.length) {
            this.fileListElement.innerHTML = '<div>No audio files uploaded</div>';
            return;
        }
        
        files.forEach(f => {
            const el = document.createElement('div');
            el.className = f.isCurrent ? 'file-item current' : 'file-item';
            if (f.isCurrent && this.audioEngine.playing) {
                el.innerHTML = `<span class="playing-indicator">▶</span> ${f.name}`;
            } else {
                el.textContent = f.name;
            }
            this.fileListElement.appendChild(el);
        });
        
        // Show file browser when in file mode
        if (this.fileBrowserElement) {
            this.fileBrowserElement.classList.toggle('hidden', this.appState.audioSource !== 'file');
        }
    }
    updatePerformanceActiveEffects() {
        // No longer needed but keeping method to avoid breaking references
    }
    updatePlayButtonState(isPlaying) {
        this.playButton?.classList.toggle('active', isPlaying);
        this.stopButton?.classList.toggle('active', !isPlaying);
        this.performancePlayButton?.classList.toggle('active', isPlaying);
        this.performanceStopButton?.classList.toggle('active', !isPlaying);
        
        // Update enhanced buttons
        document.getElementById('enhanced-play-btn')?.classList.toggle('active', isPlaying);
        document.getElementById('enhanced-stop-btn')?.classList.toggle('active', !isPlaying);
        
        // Update file displays to show playing state
        if (this.appState.audioSource === 'file') {
            this.updateCurrentFileDisplay();
            this.updateFileBrowser();
        }
    }
    
    // New method to update selected effects
    updateSelectedEffects() {
        // Get selected effects directly from the quick panel buttons
        const selectedEffects = Array.from(document.querySelectorAll('.effect-quick-btn.active'))
            .map(button => button.dataset.effect);
        
        // If no effects are selected, select at least filter by default
        if (selectedEffects.length === 0) {
            selectedEffects.push('filter');
            // Find and activate the filter button
            const filterButton = document.querySelector('.effect-quick-btn[data-effect="filter"]');
            if (filterButton) filterButton.classList.add('active');
        }
        
        // Update the parameter mapper with selected effects
        this.parameterMapper.setSelectedEffects(selectedEffects);
        
        // Also update the checkboxes in the hidden panel to stay in sync
        document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
            checkbox.checked = selectedEffects.includes(checkbox.dataset.effect);
        });
        
        console.log('Selected effects updated:', selectedEffects);
        
        // Force re-creation of random mappings when effects selection changes
        // This ensures only the selected effects are used right away
        const chaosSlider = document.getElementById('chaos-level');
        const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
        this.parameterMapper.createRandomMappings(selectedEffects, chaosLevel);
        this.updatePerformanceMappingsDisplay();
    }
    
    // Modify the syncEffectSelection method to properly sync between panels
    syncEffectSelection() {
        console.log('Syncing effect selection');
        
        // Get currently selected effects from the parameter mapper
        const selectedEffects = this.parameterMapper.getSelectedEffects();
        console.log('Selected effects from mapper:', selectedEffects);
        
        // Update quick panel buttons - First make sure they're all defaulted to inactive
        document.querySelectorAll('.effect-quick-btn').forEach(btn => {
            // Clear existing active state
            btn.classList.remove('active');
            
            // Set active if this effect is selected
            if (selectedEffects.includes(btn.dataset.effect)) {
                btn.classList.add('active');
            }
        });
        
        // Update checkboxes
        document.querySelectorAll('.effect-checkbox').forEach(checkbox => {
            checkbox.checked = selectedEffects.includes(checkbox.dataset.effect);
        });
    }
    
    // Add a new method to show feedback when using the quick select panel
    showQuickSelectFeedback(message) {
        console.log('Showing quick select feedback:', message);
        
        // Remove any existing feedback
        const existingFeedback = document.querySelector('.quick-select-feedback');
        if (existingFeedback && existingFeedback.parentNode) {
            existingFeedback.parentNode.removeChild(existingFeedback);
        }
        
        const feedbackEl = document.createElement('div');
        feedbackEl.className = 'quick-select-feedback';
        feedbackEl.textContent = message;
        
        const panel = document.querySelector('.effect-quick-select-overlay');
        if (panel) {
            panel.appendChild(feedbackEl);
            
            // Remove after animation
            setTimeout(() => {
                feedbackEl.classList.add('fade-out');
                setTimeout(() => {
                    if (feedbackEl.parentNode === panel) {
                        panel.removeChild(feedbackEl);
                    }
                }, 500);
            }, 1500);
        }
    }
    
    // Panel customization methods
    showPanelCustomizer() {
        const panelCustomizer = document.getElementById('panel-customizer');
        if (panelCustomizer) {
            panelCustomizer.classList.remove('hidden');
            
            // Update checkboxes to match current state
            this.updatePanelCustomizerCheckboxes();
        }
    }
    
    hidePanelCustomizer() {
        const panelCustomizer = document.getElementById('panel-customizer');
        if (panelCustomizer) {
            panelCustomizer.classList.add('hidden');
        }
    }
    
    updatePanelCustomizerCheckboxes() {
        // Compressor panel
        const compressorToggle = document.getElementById('toggle-compressor');
        if (compressorToggle) {
            const compressorPanel = document.querySelector('.compressor-controls');
            compressorToggle.checked = compressorPanel && !compressorPanel.classList.contains('panel-hidden');
        }
        
        // Effect selection panel
        const effectSelectionToggle = document.getElementById('toggle-effect-selection');
        if (effectSelectionToggle) {
            const effectSelectionPanel = document.querySelector('.effect-selection-container');
            effectSelectionToggle.checked = effectSelectionPanel && !effectSelectionPanel.classList.contains('panel-hidden');
        }
        
        // Chaos panel
        const chaosToggle = document.getElementById('toggle-chaos');
        if (chaosToggle) {
            const chaosPanel = document.querySelector('.chaos-control');
            chaosToggle.checked = chaosPanel && !chaosPanel.classList.contains('panel-hidden');
        }
        
        // Dry/Wet mixer panel
        const dryWetToggle = document.getElementById('toggle-drywet');
        if (dryWetToggle) {
            const dryWetPanel = document.querySelector('.drywet-control');
            dryWetToggle.checked = dryWetPanel && !dryWetPanel.classList.contains('panel-hidden');
        }
        
        // Effects display panel
        const effectsDisplayToggle = document.getElementById('toggle-effects-display');
        if (effectsDisplayToggle) {
            const effectsDisplayPanel = document.querySelector('.performance-effects-display');
            effectsDisplayToggle.checked = effectsDisplayPanel && !effectsDisplayPanel.classList.contains('panel-hidden');
        }
    }
    
    // Add drywet to panel collapsed states
    loadPanelCollapsedStates() {
        try {
            const stored = localStorage.getItem('manos-panel-collapsed');
            if (!stored) return;
            
            const collapsedStates = JSON.parse(stored);
            
            // Apply saved collapsed states
            if (collapsedStates.compressor) {
                document.querySelector('.compressor-controls')?.classList.add('collapsed');
            } else {
                document.querySelector('.compressor-controls')?.classList.remove('collapsed');
            }
            
            if (collapsedStates.effectSelection) {
                document.querySelector('.effect-selection-container')?.classList.add('collapsed');
            } else {
                document.querySelector('.effect-selection-container')?.classList.remove('collapsed');
            }
            
            if (collapsedStates.drywet) {
                document.querySelector('.drywet-control')?.classList.add('collapsed');
            } else {
                document.querySelector('.drywet-control')?.classList.remove('collapsed');
            }
        } catch (e) {
            console.error('Error loading panel collapsed states:', e);
        }
    }
    
    // Add method to save collapsed state
    savePanelCollapsedState(panelType, isCollapsed) {
        try {
            let collapsedStates = {};
            const stored = localStorage.getItem('manos-panel-collapsed');
            
            if (stored) {
                collapsedStates = JSON.parse(stored);
            }
            
            collapsedStates[panelType] = isCollapsed;
            localStorage.setItem('manos-panel-collapsed', JSON.stringify(collapsedStates));
        } catch (e) {
            console.error(`Error saving panel ${panelType} collapsed state:`, e);
        }
    }
    
    // Monitor performance to detect and respond to issues
    monitorPerformance() {
        const now = performance.now();
        
        // Skip first call
        if (this.performanceStats.lastUpdateTime === 0) {
            this.performanceStats.lastUpdateTime = now;
            return;
        }
        
        // Calculate time since last frame
        const deltaTime = now - this.performanceStats.lastUpdateTime;
        this.performanceStats.lastUpdateTime = now;
        
        // Store last 60 frame times for analysis
        this.performanceStats.frameTimes.push(deltaTime);
        if (this.performanceStats.frameTimes.length > 60) {
            this.performanceStats.frameTimes.shift();
        }
        
        // Check for stutters/glitches (frames taking more than 33ms, or below 30fps)
        if (deltaTime > 33) {
            this.performanceStats.glitchCount++;
            
            // If we've had multiple glitches recently, take action sooner
            if (this.performanceStats.glitchCount > 3 && !this.performanceStats.isThrottling) {
                this.throttleEffects();
            }
        } else {
            // Gradually reduce glitch count during good performance
            this.performanceStats.glitchCount = Math.max(0, this.performanceStats.glitchCount - 0.2);
        }
        
        // Update frame counter
        this.performanceStats.frameCount++;
        
        // Every 60 frames, check average performance
        if (this.performanceStats.frameCount % 60 === 0) {
            this.checkAveragePerformance();
        }
    }
    
    checkAveragePerformance() {
        if (this.performanceStats.frameTimes.length < 30) return;
        
        // Calculate average frame time
        const avgFrameTime = this.performanceStats.frameTimes.reduce((sum, time) => sum + time, 0) / 
                            this.performanceStats.frameTimes.length;
        
        // Check if performance is poor (below 30 FPS on average)
        const isPoorPerformance = avgFrameTime > 33;
        
        // If performance is good and we're throttling, consider restoring effects
        if (!isPoorPerformance && this.performanceStats.isThrottling) {
            // Only restore if glitch count is very low and it's been at least 10 seconds since last throttle
            if (this.performanceStats.glitchCount < 1 && 
                (performance.now() - this.performanceStats.lastThrottleTime) > 10000) {
                this.restoreEffects();
            }
        }
        
        // Update UI with performance information
        this.updatePerformanceUI(avgFrameTime, isPoorPerformance);
    }
    
    updatePerformanceUI(avgFrameTime, isPoorPerformance) {
        // Update CPU load indicator if it exists
        let cpuIndicator = document.getElementById('cpu-load-indicator');
        
        if (!cpuIndicator) {
            // Create CPU load indicator if it doesn't exist
            cpuIndicator = document.createElement('div');
            cpuIndicator.id = 'cpu-load-indicator';
            cpuIndicator.className = 'cpu-load-indicator';
            
            const container = document.querySelector('.video-container');
            if (container) {
                container.appendChild(cpuIndicator);
            } else {
                document.body.appendChild(cpuIndicator);
            }
        }
        
        if (cpuIndicator) {
            // Calculate CPU load percentage (30fps = 100% load)
            const loadPercentage = Math.min(100, (avgFrameTime / 33) * 100);
            
            // Update indicator
            cpuIndicator.innerHTML = `
                <div class="cpu-load-label">CPU Load</div>
                <div class="cpu-load-bar">
                    <div class="cpu-load-fill" style="width: ${loadPercentage}%"></div>
                </div>
                <div class="cpu-load-value">${Math.round(loadPercentage)}%</div>
            `;
            
            // Update class based on load
            cpuIndicator.className = 'cpu-load-indicator';
            if (loadPercentage > 90) {
                cpuIndicator.classList.add('critical');
            } else if (loadPercentage > 70) {
                cpuIndicator.classList.add('warning');
            }
        }
    }
    
    throttleEffects() {
        // Record throttle time to prevent frequent changes
        this.performanceStats.lastThrottleTime = performance.now();
        
        // Already throttling, make it more aggressive
        if (this.performanceStats.isThrottling) {
            // Reduce to only essential effects
            const minimalEffects = ['filter', 'volume'];
            this.parameterMapper.setSelectedEffects(minimalEffects);
            
            // Sync UI
            document.querySelectorAll('.effect-quick-btn').forEach(btn => {
                btn.classList.toggle('active', minimalEffects.includes(btn.dataset.effect));
            });
            
            // Also lower chaos level for even better performance
            const currentChaos = this.parameterMapper.chaosLevel;
            this.parameterMapper.setChaosLevel(Math.min(0.1, currentChaos));
            
            // Update chaos slider UI to reflect the change
            const chaosSlider = document.getElementById('chaos-level');
            if (chaosSlider) {
                chaosSlider.value = Math.round(this.parameterMapper.chaosLevel * 100);
            }
            
            try {
                // Show warning if showPerformanceWarning is available
                if (typeof this.showPerformanceWarning === 'function') {
                    this.showPerformanceWarning("Heavy processing detected! Reduced to minimal effects.", true);
                } else {
                    console.warn("Heavy processing detected! Reduced to minimal effects.");
                }
            } catch (e) {
                console.error("Error showing performance warning:", e);
            }
            
            // Check if audio context needs recovery
            this.audioEngine.checkAudioContextHealth();
            
            return;
        }
        
        // First level of throttling - reduce number of active effects
        this.performanceStats.isThrottling = true;
        
        // Get current effects and reduce to 3 most basic ones + volume
        const currentEffects = this.parameterMapper.getSelectedEffects();
        let reducedEffects = ['volume'];
        
        // Prioritize basic effects that are less CPU-intensive
        ['filter', 'panner', 'eq'].forEach(effect => {
            if (currentEffects.includes(effect)) {
                reducedEffects.push(effect);
            }
        });
        
        // Add one more effect if we have less than 3
        if (reducedEffects.length < 3 && currentEffects.length > 0) {
            for (const effect of currentEffects) {
                if (!reducedEffects.includes(effect)) {
                    reducedEffects.push(effect);
                    break;
                }
            }
        }
        
        // Apply reduced effects
        this.parameterMapper.setSelectedEffects(reducedEffects);
        
        // Update UI
        document.querySelectorAll('.effect-quick-btn').forEach(btn => {
            btn.classList.toggle('active', reducedEffects.includes(btn.dataset.effect));
        });
        
        // Create new mappings with reduced effects
        const chaosLevel = document.getElementById('chaos-level') ? 
            parseInt(document.getElementById('chaos-level').value) / 100 : 0.5;
        this.parameterMapper.createRandomMappings(undefined, chaosLevel);
        this.updatePerformanceMappingsDisplay();
        
        // Show warning to user
        this.showPerformanceWarning("Performance issues detected. Reduced active effects.", false);
    }
    
    restoreEffects() {
        if (!this.performanceStats.isThrottling) return;
        
        this.performanceStats.isThrottling = false;
        this.performanceStats.glitchCount = 0;
        
        // Show recovery message
        this.showPerformanceWarning("Performance improved. You can add more effects now.", false);
    }
    
    // Method to safely stop all audio
    stop() {
        if (!this.initialized || !this.audioEngine.currentSource) {
            return false;
        }
        
        try {
            // Completely stop all audio sources
            this.audioEngine.stop();
            
            // Show pause overlay to indicate sound is paused
            this.showPauseOverlay(true);
            
            // Update play button state
            this.updatePlayButtonState(false);
            
            return true;
        } catch (e) {
            console.error('Error stopping audio:', e);
            return false;
        }
    }
    
    // Add new method to show/hide pause overlay
    showPauseOverlay(show) {
        let pauseOverlay = document.getElementById('pause-overlay');
        
        if (!pauseOverlay) {
            // Create pause overlay if it doesn't exist
            this.createPauseOverlay();
        }
        
        // Show or hide all pause overlays
        document.querySelectorAll('.pause-overlay').forEach(overlay => {
            if (show) {
                overlay.classList.add('active');
            } else {
                overlay.classList.remove('active');
            }
        });
    }
    
    showPerformanceWarning(message, isError) {
        // Create or update performance warning element
        let warningElement = document.getElementById('performance-warning');
        
        if (!warningElement) {
            warningElement = document.createElement('div');
            warningElement.id = 'performance-warning';
            warningElement.className = 'performance-warning';
            
            // Add to DOM in a visible location
            const container = document.querySelector('.video-container');
            if (container) {
                container.appendChild(warningElement);
            } else {
                document.body.appendChild(warningElement);
            }
        }
        
        // Update message and style
        warningElement.textContent = message;
        warningElement.className = `performance-warning ${isError ? 'error' : 'warning'}`;
        warningElement.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            warningElement.style.opacity = '0';
            setTimeout(() => {
                warningElement.style.display = 'none';
                warningElement.style.opacity = '1';
            }, 500);
        }, 5000);
    }
}

// Fix the app initialization to ensure proper load order
document.addEventListener('DOMContentLoaded', () => {
    // Add device performance detection to automatically set lower chaos on slower devices
    const detectDevicePerformance = () => {
        let isLowPowerDevice = false;
        
        // Check for mobile/tablet devices which are typically lower power
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Check for number of logical processors if available
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
            isLowPowerDevice = true;
        }
        
        // Assume mobile devices need lower settings unless it's a newer iPad Pro
        if (isMobile && !(/iPad Pro/i.test(navigator.userAgent))) {
            isLowPowerDevice = true;
        }
        
        // Set lower default chaos level on low power devices
        if (isLowPowerDevice) {
            console.log("Low power device detected, reducing default chaos level");
            
            // Will be applied to ParameterMapper after initialization
            window.defaultChaosLevel = 0.1;
            
            // Also set lower frame rate targets
            window.lowPowerMode = true;
        }
    };
    
    // Run performance detection
    detectDevicePerformance();
    
    // Create oscillator count display if it doesn't exist
    const existingOscillatorCount = document.querySelector('.oscillator-count');
    if (!existingOscillatorCount) {
        const oscillatorCount = document.createElement('div');
        oscillatorCount.className = 'oscillator-count';
        oscillatorCount.textContent = 'Oscillators: 1';
        const videoContainer = document.querySelector('.video-container');
        if (videoContainer) {
            videoContainer.appendChild(oscillatorCount);
        }
    }
    
    // Immediately set up effect buttons before app initialization
    const setupEffectButtons = () => {
        document.querySelectorAll('.effect-quick-btn').forEach(button => {
            // Remove any existing listeners to prevent duplicates
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Make all buttons active by default
            newButton.classList.add('active');
            
            // Add fresh click handler to toggle active state
            newButton.addEventListener('click', () => {
                newButton.classList.toggle('active');
                console.log(`Effect ${newButton.dataset.effect} toggled: ${newButton.classList.contains('active')}`);
                
                // Get the app instance if available
                const appInstance = window.manosApp;
                if (appInstance && appInstance.updateSelectedEffects) {
                    appInstance.updateSelectedEffects();
                    // Immediately apply the effect selection
                    const chaosSlider = document.getElementById('chaos-level');
                    const chaosLevel = chaosSlider ? parseInt(chaosSlider.value) / 100 : 0.5;
                    appInstance.parameterMapper.createRandomMappings(undefined, chaosLevel);
                    appInstance.updatePerformanceMappingsDisplay();
                }
            });
        });
    };
    
    // Run button setup immediately and again after a short delay to catch late DOM updates
    setupEffectButtons();
    setTimeout(setupEffectButtons, 200);
    
    // Boot the app
    const app = new ManosApp();
    window.manosApp = app; // Make app globally accessible
    
    app.initialize().catch(err => {
        console.error('Failed to start app:', err);
    });
    
    // Set the oscillator count reference after app is created
    setTimeout(() => {
        if (app && !app.oscillatorCount) {
            app.oscillatorCount = document.querySelector('.oscillator-count');
        }
    }, 500);
    
    // Add window resize handler to adjust layout
    window.addEventListener('resize', () => {
        if (app) {
            app.updateLayoutForScreenSize();
        }
    });
});