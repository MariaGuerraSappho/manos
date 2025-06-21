import * as Tone from 'tone';

class AudioEngine {
    constructor() {
        this.initialized = false;
        this.playing = false;
        this.currentSource = null;
        this.sourceType = null;
        
        // Audio sources
        this.noise = null;
        this.mic = null;
        this.player = null;
        this.oscillators = []; // Array to hold oscillator objects
        this.activeOscillators = 0; // Track number of active oscillators
        this.maxOscillators = 5; // Limit maximum number of oscillators
        
        // Multiple file handling
        this.audioFiles = [];
        this.currentFileIndex = 0;
        
        // Device selection
        this.availableMicrophones = [];
        this.availableOutputs = [];
        this.currentMicrophoneId = '';
        this.currentOutputId = '';
        
        // Effects
        this.effects = {
            filter: null,
            delay: null,
            reverb: null,
            distortion: null,
            chorus: null,
            pitchShift: null,
            compressor: null,
            eq: null,
            panner: null,
            vibrato: null,
            phaser: null,
            tremolo: null,
            bitCrusher: null,
            volume: null
        };
        
        // Default routing
        this.sourceNode = null;
        this.outputNode = null;
        this.effectsChain = [];
        
        // Master gain for fade-out
        this.masterGain = null;
        
        // Fade timer
        this.fadeTimer = null;
        
        // Baseline volume
        this.baselineVolume = -10;
        
        // Hand presence flag
        this.handPresent = false;
        
        // For microphone meter
        this.microphoneAnalyzer = null;
        this.microphoneLevel = 0;
        this.micMeterInterval = null;
        
        // Add dry/wet mixer nodes
        this.dryGain = null;
        this.wetGain = null;
        this.dryWetMix = 1.0; // 0 = dry only, 1 = wet only
        
        // Audio context state tracking
        this.contextStarted = false;
        
        // Resource management
        this.pendingDisposal = [];
        this.scheduledDisposal = null;
        
        // Add resource management
        this.pendingDisposal = [];
        this.scheduledDisposal = null;
        
        // Add audio worklet monitoring
        this.workletErrorCount = 0;
        this.maxWorkletErrors = 3;
        this.lastErrorTime = 0;
        this.audioGlitchCount = 0;
        
        // Add node pooling for reusing common audio nodes
        this.nodePool = {
            gain: [],
            filter: []
        };
        
        // Add performance monitoring
        this.performanceMonitor = {
            lastUpdateTime: 0,
            avgUpdateInterval: 0,
            updateCount: 0,
            glitchDetected: false,
            heavyLoadDetected: false
        };
    }
    
    async initialize() {
        // Don't start the audio context yet - wait for user interaction
        console.log('Audio engine initialized - waiting for user interaction');
        
        try {
            // Initialize effects with optimized settings
            this.initializeEffects();
            
            // Initialize sources
            this.initializeSources();
            
            // Set up default routing with master gain node and limiter
            this.masterGain = this.getFromPool('gain', 0.9); // Slightly reduce overall gain
            this.sourceNode = this.getFromPool('gain', 1.0);
            this.outputNode = this.getFromPool('gain', 1.0);
            
            // Create dry/wet mixer nodes - ensure default values are correct
            this.dryGain = this.getFromPool('gain', 0);  // Start with 0% dry
            this.wetGain = this.getFromPool('gain', 1);  // Start with 100% wet
            
            // Connect the output path
            try {
                this.outputNode.connect(this.masterGain);
                this.masterGain.connect(this.limiter);
                this.limiter.toDestination();
            } catch (e) {
                console.error('Error setting up audio routing:', e);
            }

            // Enumerate available audio devices
            await this.enumerateDevices();
            
            // Initialize volume to a reasonable level
            this.effects.volume.volume.value = 0;
            
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Error initializing audio engine:', error);
            return false;
        }
    }
    
    initializeEffects() {
        // Filters - reduced Q factor to prevent resonance issues
        this.effects.filter = new Tone.Filter({
            type: 'lowpass',
            frequency: 20000,
            Q: 0.8
        });
        
        // Delay - reduced feedback to prevent runaway effects
        this.effects.delay = new Tone.FeedbackDelay({
            delayTime: 0.25,
            feedback: 0.25,
            wet: 0.5,
            maxDelay: 1 // Limit max delay time
        });
        
        // Reverb - reduced decay time and preDelay for better performance
        this.effects.reverb = new Tone.Reverb({
            decay: 2,
            wet: 0.3,
            preDelay: 0.01
        });
        
        // Distortion - reduced distortion amount for better performance
        this.effects.distortion = new Tone.Distortion({
            distortion: 0.4,
            wet: 0,
            oversample: "2x" // Reduced from 4x for better performance
        });
        
        // Chorus - optimized settings for better performance
        this.effects.chorus = new Tone.Chorus({
            frequency: 2,
            delayTime: 3,
            depth: 0.4,
            wet: 0,
            type: "sine" // Use simpler waveform for better performance
        }).start();
        
        // Pitch Shift - optimized buffer size for better performance
        this.effects.pitchShift = new Tone.PitchShift({
            pitch: 0,
            windowSize: 0.1,
            delayTime: 0,
            wet: 0
        });
        
        // Compressor - optimized settings for better performance and protection
        this.effects.compressor = new Tone.Compressor({
            threshold: -24,
            ratio: 4,
            attack: 0.01,
            release: 0.1,
            knee: 5
        });
        
        // EQ (3-band)
        this.effects.eq = new Tone.EQ3({
            low: 0,
            mid: 0,
            high: 0
        });
        
        // Panner
        this.effects.panner = new Tone.Panner(0);
        
        // Additional effects
        this.effects.vibrato = new Tone.Vibrato({
            frequency: 5,
            depth: 0.1,
            wet: 0
        });
        
        this.effects.phaser = new Tone.Phaser({
            frequency: 0.5,
            octaves: 3,
            wet: 0
        });
        
        this.effects.tremolo = new Tone.Tremolo({
            frequency: 5,
            depth: 0.5,
            wet: 0
        }).start();
        
        this.effects.bitCrusher = new Tone.BitCrusher({
            bits: 8,
            wet: 0
        });
        
        // Add volume control
        this.effects.volume = new Tone.Volume(0);
        
        // Add optimized limiter as final protection against clipping
        this.limiter = new Tone.Limiter(-3);
    }
    
    initializeSources() {
        // Pink Noise
        this.noise = null; // Will be created on demand to save resources
        
        // Microphone input
        this.mic = null; // Will be created on demand
        
        // Player for uploaded files
        this.player = null; // Will be created on demand
        
        // Initialize oscillator array (we'll create actual oscillators on demand)
        this.oscillators = [];
    }
    
    async enumerateDevices() {
        try {
            // Request permissions first to ensure we get all labeled devices
            await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Get all media devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            // Filter for audio input devices (microphones)
            this.availableMicrophones = devices.filter(device => device.kind === 'audioinput');
            
            // Filter for audio output devices (speakers)
            this.availableOutputs = devices.filter(device => device.kind === 'audiooutput');
            
            // Populate device selection dropdowns
            this.populateDeviceSelectors();
            
            // Setup change listeners
            this.setupDeviceSelectionListeners();
            
            return true;
        } catch (error) {
            console.error('Error enumerating audio devices:', error);
            return false;
        }
    }
    
    populateDeviceSelectors() {
        const micSelect = document.getElementById('mic-select');
        const outputSelect = document.getElementById('output-select');
        
        // Clear existing options
        micSelect.innerHTML = '';
        outputSelect.innerHTML = '';
        
        // Add microphone options
        if (this.availableMicrophones.length > 0) {
            this.availableMicrophones.forEach(mic => {
                const option = document.createElement('option');
                option.value = mic.deviceId;
                option.text = mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`;
                micSelect.appendChild(option);
            });
            
            // Enable the select element
            micSelect.disabled = false;
            
            // Set default microphone
            this.currentMicrophoneId = this.availableMicrophones[0].deviceId;
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.text = 'No microphones found';
            micSelect.appendChild(option);
        }
        
        // Add output options
        if (this.availableOutputs.length > 0) {
            this.availableOutputs.forEach(output => {
                const option = document.createElement('option');
                option.value = output.deviceId;
                option.text = output.label || `Speaker ${output.deviceId.slice(0, 5)}`;
                outputSelect.appendChild(option);
            });
            
            // Enable the select element
            outputSelect.disabled = false;
            
            // Set default output
            this.currentOutputId = this.availableOutputs[0].deviceId;
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.text = 'No speakers found';
            outputSelect.appendChild(option);
        }
    }
    
    setupDeviceSelectionListeners() {
        const micSelect = document.getElementById('mic-select');
        const outputSelect = document.getElementById('output-select');
        
        // Microphone selection change
        micSelect.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (deviceId && deviceId !== this.currentMicrophoneId) {
                this.currentMicrophoneId = deviceId;
                
                // If current source is microphone, update it
                if (this.sourceType === 'mic' && this.playing) {
                    await this.mic.close();
                    this.mic = new Tone.UserMedia({ 
                        deviceId: this.currentMicrophoneId ? { exact: this.currentMicrophoneId } : undefined,
                        volume: 0, // Start at normal volume (changed from -10)
                        mute: false
                    });
                    
                    await this.setSource('mic');
                }
            }
        });
        
        // Output selection change
        outputSelect.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (deviceId && deviceId !== this.currentOutputId) {
                this.currentOutputId = deviceId;
                
                // Try to set the output device
                try {
                    // We'll need to recreate the audio context with the selected sink ID
                    // This is not directly supported in Tone.js, so we'll need a workaround
                    // For now, just show an alert that this requires reloading the page
                    alert('Changing audio output requires reloading the page. Please reload after selecting a new output.');
                } catch (error) {
                    console.error('Error setting audio output device:', error);
                }
            }
        });
    }
    
    async setSource(sourceType) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        // Stop current source if playing
        if (this.playing) {
            this.stop();
        }
        
        // Ensure audio context is started
        await this.startAudioContext();
        
        // Schedule previous source for disposal
        if (this.currentSource) {
            this.scheduleForDisposal(this.currentSource);
        }
        
        this.sourceType = sourceType;
        
        switch (sourceType) {
            case 'noise':
                // Create noise source on demand
                this.noise = new Tone.Noise('pink').set({
                    volume: -10, // Start at a reasonable volume
                    fadeIn: 0.1, // Prevent clicks
                    fadeOut: 0.1 // Prevent clicks
                });
                this.currentSource = this.noise;
                break;
                
            case 'mic':
                try {
                    // Close existing microphone connection if any
                    if (this.mic && this.mic.state === 'started') {
                        await this.mic.close();
                        this.scheduleForDisposal(this.mic);
                    }
                    
                    // Create new microphone with selected device
                    this.mic = new Tone.UserMedia({ 
                        deviceId: this.currentMicrophoneId ? { exact: this.currentMicrophoneId } : undefined,
                        volume: 0, // Start at normal volume (changed from -10)
                        mute: false
                    });
                    
                    await this.mic.open().catch(e => {
                        console.error('Microphone open error:', e);
                        alert('Could not access microphone. Please check your permissions and try again.');
                        throw e; // Re-throw for promise rejection handling
                    });
                    this.currentSource = this.mic;
                    
                    // Show mic meter containers
                    document.querySelectorAll('.mic-meter-container, .performance-mic-meter-container').forEach(container => {
                        container.classList.remove('hidden');
                        container.classList.add('active');
                    });
                    
                    // Start the microphone meter
                    this.startMicrophoneMeter();
                } catch (e) {
                    console.error('Microphone access error:', e);
                    alert('Could not access microphone. Please check your permissions and try again.');
                    return false;
                }
                break;
                
            case 'file':
                if (this.audioFiles.length === 0) {
                    console.error('No audio files loaded');
                    alert('No audio files loaded. Please upload audio files first.');
                    return false;
                }
                
                // Set the current file based on the current index
                await this.loadCurrentFile();
                
                if (!this.player || !this.player.loaded) {
                    console.error('Could not load audio file');
                    alert('Could not load audio file. Please try uploading again.');
                    return false;
                }
                
                this.currentSource = this.player;
                break;
                
            case 'oscillators':
                // Clean up existing oscillators
                this.cleanupOscillators();
                
                // Create a new gain node as the source for all oscillators
                this.currentSource = new Tone.Gain(1);
                
                // Initialize with one oscillator by default
                this.updateOscillatorCount(1);
                break;
                
            default:
                console.error('Invalid source type');
                return false;
        }
        
        // Connect to source node and set up dry/wet routing
        if (this.currentSource) {
            try {
                this.currentSource.disconnect();
                
                // Connect source to both dry and wet paths
                this.currentSource.connect(this.sourceNode);
                this.currentSource.connect(this.dryGain);
                
                // For microphone specifically, create analyzer for level meter
                if (sourceType === 'mic' && this.mic) {
                    if (this.microphoneAnalyzer) {
                        this.mic.disconnect(this.microphoneAnalyzer);
                        this.scheduleForDisposal(this.microphoneAnalyzer);
                    }
                    this.microphoneAnalyzer = new Tone.Analyser('waveform', 1024);
                    this.mic.connect(this.microphoneAnalyzer);
                }
            } catch (e) {
                console.error('Error setting up audio routing:', e);
            }
        }
        
        // Update effect chain
        this.updateEffectsChain();
        
        // Hide mic meter containers if not using mic
        if (sourceType !== 'mic') {
            document.querySelectorAll('.mic-meter-container, .performance-mic-meter-container').forEach(container => {
                container.classList.add('hidden');
                container.classList.remove('active');
            });
            
            // Stop microphone meter if active
            this.stopMicrophoneMeter();
        }
        
        return true;
    }
    
    // New method to get a node from the pool or create a new one
    getFromPool(type, initialValue = 1) {
        if (!this.nodePool[type] || this.nodePool[type].length === 0) {
            // Create a new node if pool is empty
            if (type === 'gain') {
                return new Tone.Gain(initialValue);
            } else if (type === 'filter') {
                return new Tone.Filter(initialValue);
            }
            // Add other node types as needed
            return null;
        }
        
        // Get node from pool and reset its value
        const node = this.nodePool[type].pop();
        if (type === 'gain') {
            node.gain.value = initialValue;
        } else if (type === 'filter') {
            node.frequency.value = initialValue;
        }
        return node;
    }
    
    // Method to return a node to the pool for reuse
    returnToPool(node, type) {
        if (!node) return;
        
        try {
            // Disconnect the node before returning to pool
            node.disconnect();
            
            // Add to pool if we have space, otherwise dispose
            if (this.nodePool[type] && this.nodePool[type].length < 10) {
                this.nodePool[type].push(node);
            } else {
                this.scheduleForDisposal(node);
            }
        } catch (e) {
            console.warn('Error returning node to pool:', e);
            this.scheduleForDisposal(node);
        }
    }
    
    // New method to clean up oscillators properly
    cleanupOscillators() {
        // Safely dispose of all oscillators
        this.oscillators.forEach(osc => {
            if (osc && osc.state === "started") {
                try {
                    osc.stop();
                } catch (e) {
                    console.warn('Error stopping oscillator:', e);
                }
            }
            this.scheduleForDisposal(osc);
        });
        this.oscillators = [];
        this.activeOscillators = 0;
    }
    
    // New method to handle resource disposal safely
    scheduleForDisposal(node) {
        if (!node) return;
        
        this.pendingDisposal.push(node);
        
        // Schedule a cleanup after a short delay to avoid glitches
        if (!this.scheduledDisposal) {
            this.scheduledDisposal = setTimeout(() => {
                this.performDisposal();
            }, 500); // Wait 500ms to make sure audio processing is done
        }
    }
    
    // Actually perform the disposal of nodes
    performDisposal() {
        while (this.pendingDisposal.length > 0) {
            const node = this.pendingDisposal.shift();
            try {
                if (node && typeof node.dispose === 'function') {
                    node.dispose();
                }
            } catch (e) {
                console.warn('Error disposing audio node:', e);
            }
        }
        this.scheduledDisposal = null;
    }
    
    // Report worklet errors to trigger throttling if needed
    reportWorkletError() {
        const now = performance.now();
        this.workletErrorCount++;
        this.lastErrorTime = now;
        
        if (this.workletErrorCount >= this.maxWorkletErrors) {
            this.workletErrorCount = 0;
            
            // Notify any listeners about audio processing issues
            if (window.manosApp && window.manosApp.throttleEffects) {
                window.manosApp.throttleEffects();
            }
        }
    }
    
    // Check if we're experiencing performance issues and respond accordingly
    checkPerformance() {
        // Check if we're running at a reasonable update rate
        const now = performance.now();
        if (this.performanceMonitor.lastUpdateTime > 0) {
            const updateInterval = now - this.performanceMonitor.lastUpdateTime;
            
            // Track average update interval with weighted moving average
            if (this.performanceMonitor.avgUpdateInterval === 0) {
                this.performanceMonitor.avgUpdateInterval = updateInterval;
            } else {
                this.performanceMonitor.avgUpdateInterval = 
                    this.performanceMonitor.avgUpdateInterval * 0.9 + updateInterval * 0.1;
            }
            
            // If updates are too infrequent, we may be experiencing glitches
            if (updateInterval > 50 && this.performanceMonitor.updateCount > 10) {
                this.performanceMonitor.glitchDetected = true;
                this.audioGlitchCount++;
                
                // If we're experiencing many glitches, reduce audio complexity
                if (this.audioGlitchCount > 2 && !this.performanceMonitor.heavyLoadDetected) { // Reduced threshold from 3 to 2
                    this.performanceMonitor.heavyLoadDetected = true;
                    this.reduceAudioComplexity();
                    
                    // Notify any listeners about audio processing issues
                    if (window.manosApp && window.manosApp.throttleEffects) {
                        window.manosApp.throttleEffects();
                    }
                }
            } else {
                // Reset glitch detection if we're running smoothly
                this.performanceMonitor.glitchDetected = false;
                this.audioGlitchCount = Math.max(0, this.audioGlitchCount - 0.1);
            }
        }
        
        this.performanceMonitor.lastUpdateTime = now;
        this.performanceMonitor.updateCount++;
    }
    
    // Reduce audio complexity to improve performance
    reduceAudioComplexity() {
        console.warn('Reducing audio complexity due to performance issues');
        
        try {
            // Simplify effects parameters more aggressively
            if (this.effects.reverb && this.effects.reverb.wet) {
                this.effects.reverb.wet.value = Math.min(0.2, this.effects.reverb.wet.value);
                if (this.effects.reverb.decay) {
                    this.effects.reverb.decay.value = Math.min(1.5, this.effects.reverb.decay.value);
                }
            }
            
            if (this.effects.delay && this.effects.delay.feedback) {
                this.effects.delay.feedback.value = Math.min(0.15, this.effects.delay.feedback.value);
                this.effects.delay.wet.value = Math.min(0.2, this.effects.delay.wet.value);
            }
            
            if (this.effects.chorus) {
                this.effects.chorus.wet.value = Math.min(0.2, this.effects.chorus.wet.value);
            }
            
            if (this.effects.pitchShift) {
                this.effects.pitchShift.wet.value = Math.min(0.2, this.effects.pitchShift.wet.value);
            }
            
            if (this.effects.bitCrusher) {
                this.effects.bitCrusher.wet.value = Math.min(0.1, this.effects.bitCrusher.wet.value);
            }

            if (this.effects.distortion) {
                this.effects.distortion.wet.value = Math.min(0.2, this.effects.distortion.wet.value);
            }
            
            // Limit number of active effects
            this.updateEffectsChain();
            
            // Ensure audio context is healthy
            this.checkAudioContextHealth();
        } catch (e) {
            console.error('Error reducing audio complexity:', e);
        }
    }
    
    // Check if audio context is in a healthy state and attempt recovery if not
    checkAudioContextHealth() {
        if (Tone.context.state === 'suspended' || Tone.context.state === 'interrupted') {
            console.warn('Audio context in bad state:', Tone.context.state);
            this.recoverAudioContext();
            return false;
        }
        return true;
    }
    
    // Attempt to recover audio context if it's in a bad state
    async recoverAudioContext() {
        try {
            console.log('Attempting to recover audio context...');
            
            // First try to resume the context
            await Tone.context.resume();
            
            // If that doesn't work, create a new Tone.js context as a last resort
            if (Tone.context.state !== 'running') {
                console.warn('Rebuilding audio context...');
                
                // Stop all current audio
                this.stop();
                
                // Dispose all current audio nodes
                this.performDisposal();
                
                // Create a new context
                Tone.context.close();
                Tone.setContext(new Tone.Context());
                
                // Reinitialize the audio engine
                await this.initialize();
                
                // Show feedback to user
                if (window.manosApp && window.manosApp.showPerformanceWarning) {
                    window.manosApp.showPerformanceWarning("Audio engine recovered. Please try playing again.", false);
                }
            }
            
            return Tone.context.state === 'running';
        } catch (err) {
            console.error('Failed to recover audio context:', err);
            return false;
        }
    }
    
    async loadAudioFiles(files) {
        if (!files || files.length === 0) {
            return false;
        }
        
        // Ensure audio context is started
        await this.startAudioContext();
        
        // Clear existing files
        this.audioFiles = [];
        this.currentFileIndex = 0;
        
        // If there's an existing player, schedule it for disposal
        if (this.player) {
            this.scheduleForDisposal(this.player);
            this.player = null;
        }
        
        // Process each file
        for (const file of files) {
            try {
                // Read the file as ArrayBuffer
                const buffer = await this.readFileAsArrayBuffer(file);
                
                // Store file info
                this.audioFiles.push({
                    name: file.name,
                    buffer: buffer,
                    size: file.size
                });
            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                // Continue with other files
            }
        }
        
        // If we have files, set source to file
        if (this.audioFiles.length > 0) {
            try {
                await this.loadCurrentFile();
                this.currentSource = this.player;
                this.sourceType = 'file';
                this.currentSource.connect(this.sourceNode);
                this.updateEffectsChain();
                return true;
            } catch (error) {
                console.error("Error setting up audio file:", error);
                return false;
            }
        }
        
        return false;
    }
    
    async loadAudioFile(file) {
        return this.loadAudioFiles([file]);
    }
    
    async nextAudioFile() {
        if (this.audioFiles.length <= 1) return Promise.resolve(false);
        
        // Increment the current file index (with wrapping)
        this.currentFileIndex = (this.currentFileIndex + 1) % this.audioFiles.length;
        
        // If we're playing files, update the current file
        if (this.sourceType === 'file') {
            const wasPlaying = this.playing;
            
            this.stop();
            
            // Schedule old player for disposal
            if (this.player) {
                this.scheduleForDisposal(this.player);
                this.player = null;
            }
            
            return this.loadCurrentFile().then(() => {
                if (this.player) {
                    this.currentSource = this.player;
                    this.currentSource.connect(this.sourceNode);
                    
                    if (wasPlaying) {
                        this.play();
                    }
                    return Promise.resolve(true);
                }
                return Promise.resolve(false);
            });
        }
        
        return Promise.resolve(true);
    }
    
    getAudioFileList() {
        return this.audioFiles.map((file, index) => ({
            name: file.name,
            index: index,
            isCurrent: index === this.currentFileIndex
        }));
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
                // Use a defensive copy of the buffer to prevent issues with reusing buffers
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
    
    updateEffectsChain() {
        // Store references to current effects chain for cleanup
        const oldEffectsChain = [...this.effectsChain];
        
        // Disconnect everything
        this.sourceNode.disconnect();
        this.dryGain.disconnect();
        this.wetGain.disconnect();
        
        // Properly disconnect old effects chain
        oldEffectsChain.forEach(effect => {
            try {
                effect.disconnect();
            } catch (e) {
                console.warn('Error disconnecting effect:', e);
            }
        });
        
        this.effectsChain = [];
        
        // Always add compressor at the beginning of the chain for protection
        this.effectsChain.push(this.effects.compressor);
        
        // Always add volume control after compressor
        this.effectsChain.push(this.effects.volume);
        
        // Filter active effects - only include effects that are actually used
        for (const key in this.effects) {
            if (key === 'volume' || key === 'compressor') continue; // Skip already added effects
            
            if (this.effects[key].wet && this.effects[key].wet.value > 0.01) {
                this.effectsChain.push(this.effects[key]);
            } else if ((key === 'filter' && this.effects[key].frequency.value < 19000) || 
                      (key === 'eq' && (this.effects[key].low.value !== 0 || this.effects[key].mid.value !== 0 || this.effects[key].high.value !== 0)) || 
                      (key === 'panner' && this.effects[key].pan.value !== 0)) {
                // Only include filter/eq/panner if they're actually doing something
                this.effectsChain.push(this.effects[key]);
            }
        }
        
        // Create the chain with dry/wet mix - optimize routing by connecting directly when possible
        if (this.effectsChain.length > 0) {
            try {
                // Connect source to both dry and wet paths
                this.sourceNode.connect(this.effectsChain[0]);
                
                // Connect effects in sequence
                for (let i = 0; i < this.effectsChain.length - 1; i++) {
                    this.effectsChain[i].connect(this.effectsChain[i + 1]);
                }
                
                // Connect last effect to wet gain node
                this.effectsChain[this.effectsChain.length - 1].connect(this.wetGain);
                
                // Make sure both wet and dry paths connect to output
                this.wetGain.connect(this.outputNode);
                this.dryGain.connect(this.outputNode);
            } catch (e) {
                console.error('Error connecting effects chain:', e);
                // Fallback to direct connection if chain connection fails
                this.sourceNode.connect(this.outputNode);
            }
        } else {
            // No effects, connect source directly to output
            this.sourceNode.connect(this.outputNode);
        }
        
        // Monitor CPU usage for this operation
        this.checkPerformance();
    }
    
    async startAudioContext() {
        if (this.contextStarted) {
            return true;
        }
        
        try {
            // Start the audio context when user wants to play
            await Tone.start();
            this.contextStarted = true;
            console.log('Audio context started successfully');
            return true;
        } catch (error) {
            console.error('Error starting audio context:', error);
            return false;
        }
    }
    
    async play() {
        if (!this.initialized || !this.currentSource) {
            console.error('Audio engine not initialized or no source selected');
            return false;
        }
        
        // Start the audio context when user wants to play
        const contextStarted = await this.startAudioContext();
        if (!contextStarted) {
            console.error('Failed to start audio context');
            return false;
        }
        
        if (this.playing) return true;
        
        try {
            // Restore master gain
            this.masterGain.gain.value = 1;
            
            switch (this.sourceType) {
                case 'noise':
                    if (!this.noise) {
                        this.noise = new Tone.Noise('pink').set({
                            volume: -10,
                            fadeIn: 0.1,
                            fadeOut: 0.1
                        });
                        this.noise.connect(this.sourceNode);
                        this.currentSource = this.noise;
                    }
                    this.noise.start();
                    break;
                
                case 'mic':
                    // Mic is already streaming once opened
                    if (!this.mic || this.mic.state !== 'started') {
                        await this.setSource('mic');
                    } else {
                        // Restore volume if mic was muted
                        this.mic.volume.value = 0;
                    }
                    break;
                
                case 'file':
                    if (!this.player || !this.player.loaded) {
                        console.error('Player not loaded');
                        return false;
                    }
                    this.player.start();
                    break;
                    
                case 'oscillators':
                    // Start all oscillators
                    this.oscillators.forEach(osc => {
                        if (osc && osc.state !== 'started') {
                            osc.start();
                        }
                    });
                    break;
            }
            
            this.playing = true;
            return true;
        } catch (e) {
            console.error('Error playing audio:', e);
            return false;
        }
    }
    
    // Method to safely stop all audio
    stop() {
        if (!this.initialized || !this.currentSource) {
            return false;
        }
        
        try {
            switch (this.sourceType) {
                case 'noise':
                    if (this.noise) {
                        this.noise.stop();
                    }
                    break;
                
                case 'mic':
                    // For microphone, we need to disconnect to truly stop sound
                    if (this.mic) {
                        // Keep mic open but mute it completely
                        this.mic.volume.value = -Infinity; 
                    }
                    break;
                
                case 'file':
                    if (this.player) {
                        this.player.stop();
                    }
                    break;
                    
                case 'oscillators':
                    // Stop all oscillators
                    this.oscillators.forEach(osc => {
                        if (osc && osc.state === 'started') {
                            osc.stop();
                        }
                    });
                    break;
            }
            
            // Ensure silence by setting master gain to 0
            this.masterGain.gain.value = 0;
            
            this.playing = false;
            return true;
        } catch (e) {
            console.error('Error stopping audio:', e);
            return false;
        }
    }
    
    fadeOut(duration = 0.5) {
        return new Promise(resolve => {
            if (!this.playing) {
                resolve(false);
                return;
            }
            
            try {
                // Fade out
                this.effects.volume.volume.rampTo(-60, duration);
                
                // Resolve after fade completes
                setTimeout(() => {
                    resolve(true);
                }, duration * 1000);
            } catch (e) {
                console.error('Error during fadeOut:', e);
                resolve(false);
            }
        });
    }
    
    fadeIn(duration = 0.5) {
        if (!this.playing) return;
        
        try {
            // Fade in from silence
            this.effects.volume.volume.value = -60;
            this.effects.volume.volume.rampTo(this.baselineVolume, duration);
        } catch (e) {
            console.error('Error during fadeIn:', e);
        }
    }
    
    setEffectParameter(effectName, parameter, value) {
        if (!this.initialized || !this.effects[effectName]) {
            return false;
        }
        
        try {
            const effect = this.effects[effectName];
            
            // Special handling for volume to ensure it works properly
            if (effectName === 'volume' && parameter === 'volume') {
                // Use rampTo for smoother volume changes
                this.effects.volume.volume.rampTo(value, 0.1);
                return true;
            }
            
            // Special handling for filter type (convert from numeric to string type)
            if (effectName === 'filter' && parameter === 'type') {
                // Map numeric values to filter types
                const filterTypes = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass'];
                // Make sure we have a valid index by rounding and clamping
                const index = Math.max(0, Math.min(Math.floor(value * filterTypes.length), filterTypes.length - 1));
                try {
                    effect.type = filterTypes[index];
                } catch (e) {
                    console.warn(`Error setting filter type ${filterTypes[index]} from value ${value}, using default`);
                    effect.type = 'lowpass'; // Use default type if there's an error
                }
                return true;
            }
            
            // Handle special cases with smooth ramping for most parameters
            if (parameter === 'wet' && effect.wet) {
                if (effect.wet.rampTo) {
                    effect.wet.rampTo(value, 0.1); // Smooth transition over 100ms
                } else {
                    effect.wet.value = value;
                }
            } else if (effect[parameter] !== undefined) {
                if (typeof effect[parameter] === 'object' && effect[parameter].value !== undefined) {
                    // Use rampTo for parameters that support it
                    if (effect[parameter].rampTo) {
                        effect[parameter].rampTo(value, 0.1); // Smooth transition
                    } else {
                        effect[parameter].value = value;
                    }
                } else {
                    effect[parameter] = value;
                }
            } else {
                console.warn(`Parameter ${parameter} not found on effect ${effectName}`);
                return false;
            }
            
            // Update effects chain if wet parameter changed
            if (parameter === 'wet') {
                this.updateEffectsChain();
            }
            
            return true;
        } catch (e) {
            console.error(`Error setting ${parameter} on ${effectName}:`, e);
            return false;
        }
    }
    
    getActiveEffects() {
        const active = {};
        
        for (const key in this.effects) {
            if (this.effects[key].wet && this.effects[key].wet.value > 0) {
                active[key] = true;
            } else if (key === 'filter' || key === 'compressor' || key === 'eq' || key === 'panner') {
                // Always include these effects in the active list
                active[key] = true;
            }
        }
        
        return active;
    }
    
    setBaselineVolume(value) {
        this.baselineVolume = value;
        
        // Apply the volume change immediately for testing
        this.effects.volume.volume.value = value;
        
        // Make sure master gain is at full to hear the volume change
        this.masterGain.gain.value = 1;
        
        // If we're currently playing, ensure volume is audible
        if (!this.playing && this.sourceType) {
            this.play();
        }
        
        console.log('Baseline volume set to:', value);
    }
    
    fadeOutAll() {
        // Clear any existing fade timer
        if (this.fadeTimer) {
            clearTimeout(this.fadeTimer);
        }
        
        // Start a new fade-out over 1 second - faster for better UX
        this.masterGain.gain.rampTo(0, 1);
        
        // Set a timer to completely stop all sources after fade completes
        this.fadeTimer = setTimeout(() => {
            // Stop all sources except microphone
            if (this.playing && this.sourceType !== 'mic') {
                switch (this.sourceType) {
                    case 'noise':
                        if (this.noise) {
                            this.noise.stop();
                        }
                        break;
                    
                    case 'file':
                        if (this.player) {
                            this.player.stop();
                        }
                        break;
                        
                    case 'oscillators':
                        // Stop all oscillators
                        this.oscillators.forEach(osc => {
                            if (osc && osc.state === 'started') {
                                osc.stop();
                            }
                        });
                        break;
                }
            }
            
            // Keep master gain at 0 until fadeInAll is called
            this.masterGain.gain.value = 0;
        }, 1000);
    }
    
    fadeInAll() {
        // If we're faded out, fade back in
        if (this.masterGain.gain.value < 1) {
            this.masterGain.gain.rampTo(1, 0.5);
        }
        
        // Clear any fade-out timer
        if (this.fadeTimer) {
            clearTimeout(this.fadeTimer);
            this.fadeTimer = null;
        }
        
        // Make sure we're playing if we were stopped
        if (!this.playing && this.sourceType && this.sourceType !== 'mic') {
            this.play();
        }
    }
    
    // Add method to set master volume
    setMasterVolume(value) {
        try {
            // Set master gain in dB (-60 to 0)
            const dbValue = Math.max(-60, Math.min(0, value));
            
            // Convert dB to linear gain (0 to 1)
            const linearGain = Math.pow(10, dbValue / 20);
            
            // Apply the gain
            this.masterGain.gain.value = linearGain;
            
            console.log(`Master volume set to ${dbValue} dB (${linearGain.toFixed(3)} gain)`);
            
            // If volume is below -40dB, effectively mute by stopping playback
            if (dbValue <= -40) {
                if (this.playing) {
                    this.stop(); // This now properly sets playing to false
                }
                this.masterGain.gain.value = 0; // Ensure zero gain
                
                // Show pause overlay to indicate sound is paused
                if (window.manosApp && window.manosApp.showPauseOverlay) {
                    window.manosApp.showPauseOverlay(true);
                }
            } else if (dbValue > -40 && !this.playing && this.sourceType) {
                // Resume playback if we were previously playing
                this.play();
                
                // Hide pause overlay
                if (window.manosApp && window.manosApp.showPauseOverlay) {
                    window.manosApp.showPauseOverlay(false);
                }
            }
            
            return true;
        } catch (e) {
            console.error('Error setting master volume:', e);
            return false;
        }
    }
    
    // Add method to set dry/wet mix
    setDryWetMix(mix) {
        try {
            // mix: 0 = fully dry, 1 = fully wet
            this.dryWetMix = Math.min(1, Math.max(0, mix));
            
            // Update gain values with correct curve for equal power crossfade
            // When mix is 0, dry should be 1 (full volume) and wet should be 0 (silent)
            // When mix is 1, dry should be 0 (silent) and wet should be 1 (full volume)
            const dryValue = Math.cos(this.dryWetMix * Math.PI/2);
            const wetValue = Math.sin(this.dryWetMix * Math.PI/2);
            
            // Use rampTo for smoother transition
            if (this.dryGain && this.dryGain.gain) {
                this.dryGain.gain.rampTo(dryValue, 0.1);
            } else {
                console.warn('Dry gain node not properly initialized');
            }
            
            if (this.wetGain && this.wetGain.gain) {
                this.wetGain.gain.rampTo(wetValue, 0.1);
            } else {
                console.warn('Wet gain node not properly initialized');
            }
            
            console.log(`Dry/Wet mix set to: ${Math.round(this.dryWetMix * 100)}% wet, dry gain: ${dryValue}, wet gain: ${wetValue}`);
        } catch (e) {
            console.error('Error setting dry/wet mix:', e);
        }
    }
    
    // Dispose of all resources when cleaning up
    dispose() {
        // Stop any playing sources first
        this.stop();
        
        // Clean up all audio nodes
        if (this.sourceNode) this.scheduleForDisposal(this.sourceNode);
        if (this.outputNode) this.scheduleForDisposal(this.outputNode);
        if (this.dryGain) this.scheduleForDisposal(this.dryGain);
        if (this.wetGain) this.scheduleForDisposal(this.wetGain);
        if (this.masterGain) this.scheduleForDisposal(this.masterGain);
        
        // Clean up sources
        if (this.noise) this.scheduleForDisposal(this.noise);
        if (this.mic) this.scheduleForDisposal(this.mic);
        if (this.player) this.scheduleForDisposal(this.player);
        this.cleanupOscillators();
        
        // Clean up effects
        for (const key in this.effects) {
            if (this.effects[key]) this.scheduleForDisposal(this.effects[key]);
        }
        
        // Force immediate disposal
        this.performDisposal();
        
        // Clear timers
        if (this.fadeTimer) {
            clearTimeout(this.fadeTimer);
            this.fadeTimer = null;
        }
        
        if (this.scheduledDisposal) {
            clearTimeout(this.scheduledDisposal);
            this.scheduledDisposal = null;
        }
        
        if (this.micMeterInterval) {
            clearInterval(this.micMeterInterval);
            this.micMeterInterval = null;
        }
        
        this.initialized = false;
    }
    
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = (error) => {
                reject(error);
            };
            
            reader.readAsArrayBuffer(file);
        });
    }
    
    // New method to update oscillator count based on finger detection
    updateOscillatorCount(count, pitchOffset = 0) {
        // Limit count to 1-5 oscillators
        count = Math.max(1, Math.min(this.maxOscillators, count));
        
        // Only update if the count has changed or we have a pitch change
        if (count === this.activeOscillators && this.oscillators.length === count && 
            this.currentPitchOffset === pitchOffset && this.oscillators.length > 0) {
            return;
        }
        
        // Store current pitch offset
        this.currentPitchOffset = pitchOffset;
        
        // Clean up current oscillators if source type is oscillators
        if (this.sourceType === 'oscillators') {
            this.cleanupOscillators();
            
            // Create new oscillators with more musical frequencies (major chord)
            // Base frequencies - will be modified by pitch offset
            const baseFrequencies = [
                261.63, // C4
                329.63, // E4
                392.00, // G4
                523.25, // C5
                659.25  // E5
            ];
            
            // Apply pitch offset (semitones)
            const frequencies = baseFrequencies.map(freq => 
                freq * Math.pow(2, pitchOffset/12)
            );
            
            // Create the specified number of oscillators
            for (let i = 0; i < count; i++) {
                // Use sine wave for cleaner sound, and different waveforms for variety
                const waveforms = ['sine', 'triangle', 'sine', 'triangle', 'sine'];
                const osc = new Tone.Oscillator({
                    frequency: frequencies[i],
                    type: waveforms[i],
                    volume: -15, // Lower initial volume for cleaner mix
                    fadeIn: 0.1,
                    fadeOut: 0.1
                });
                
                // If we're already playing, start the oscillator
                if (this.playing) {
                    osc.start();
                    // Add fade in for smooth transition
                    osc.volume.value = -60;
                    osc.volume.rampTo(-15, 0.2);
                }
                
                // Connect to the source node
                osc.connect(this.currentSource);
                
                // Add to array
                this.oscillators.push(osc);
            }
            
            this.activeOscillators = count;
        }
    }
    
    // New method to start microphone level monitoring
    startMicrophoneMeter() {
        try {
            // Stop any existing monitoring
            this.stopMicrophoneMeter();
            
            // Make sure we have an analyzer connected to the microphone
            if (!this.microphoneAnalyzer && this.mic && this.mic.state === 'started') {
                this.microphoneAnalyzer = new Tone.Analyser('waveform', 1024);
                this.mic.connect(this.microphoneAnalyzer);
            }
            
            // Start monitoring level
            this.micMeterInterval = setInterval(() => {
                if (this.microphoneAnalyzer && this.sourceType === 'mic' && this.mic) {
                    try {
                        const waveform = this.microphoneAnalyzer.getValue();
                        let sum = 0;
                        
                        // Calculate RMS (root mean square) of the waveform
                        for (let i = 0; i < waveform.length; i++) {
                            sum += waveform[i] * waveform[i];
                        }
                        
                        // Get the average and calculate the RMS
                        const rms = Math.sqrt(sum / waveform.length);
                        
                        // Scale to a reasonable value (0-100) and amplify more for better visibility
                        this.microphoneLevel = Math.min(100, Math.max(0, rms * 800 * 100));
                        
                        // Update the main audio meter instead of mic meter
                        this.updateAudioMeter(this.microphoneLevel);
                    } catch (e) {
                        console.warn('Error updating microphone meter:', e);
                    }
                }
            }, 50); // Update 20 times per second for smoother display
        } catch (e) {
            console.error('Error starting microphone meter:', e);
        }
    }
    
    // New method to stop microphone level monitoring
    stopMicrophoneMeter() {
        if (this.micMeterInterval) {
            clearInterval(this.micMeterInterval);
            this.micMeterInterval = null;
        }
        
        // Reset meter display
        const meterFillElements = document.querySelectorAll('.mic-meter-fill');
        meterFillElements.forEach(el => {
            if (el) el.style.width = '0%';
        });
        
        // Disconnect analyzer
        if (this.microphoneAnalyzer) {
            this.scheduleForDisposal(this.microphoneAnalyzer);
            this.microphoneAnalyzer = null;
        }
    }
    
    updateAudioMeter(level) {
        // Update volume meter with actual audio level
        const volumeFill = document.querySelector('.volume-fill');
        if (volumeFill) {
            volumeFill.style.width = `${level}%`;
            
            // Update data-label attribute to show value
            const volumeBar = document.querySelector('.volume-bar');
            if (volumeBar) {
                volumeBar.setAttribute('data-label', `VOL ${Math.round(level)}%`);
            }
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
    
    async requestCameraPermission() {
        try {
            // Setup camera
            const cameraOptions = {
                onFrame: async () => {
                    if (this.hands) {
                        await this.hands.send({ image: this.videoElement });
                    }
                },
                width: 640,
                height: 480
            };
            
            this.camera = new window.Camera(this.videoElement, cameraOptions);
            await this.camera.start();
            
            // Hide permission prompt
            if (this.permissionPrompt) {
                this.permissionPrompt.classList.add('hidden');
            }
            
            if (this.statusElement) {
                this.statusElement.textContent = 'Initialized';
            }
            
            return true;
        } catch (error) {
            console.error('Error starting camera:', error);
            if (this.statusElement) {
                this.statusElement.textContent = 'Camera error';
            }
            
            // Show permission prompt
            if (this.permissionPrompt) {
                this.permissionPrompt.classList.remove('hidden');
            }
            
            return false;
        }
    }
}

export default AudioEngine;