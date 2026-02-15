const dropArea    = document.getElementById('dropArea');
const fileInput   = document.getElementById('audioFile');
const fileNameEl  = document.getElementById('fileName');
const status      = document.getElementById('status');
const download    = document.getElementById('download');
const previewSec  = document.getElementById('previewSection');
const audioPrev   = document.getElementById('audioPreview');
const repeatBtn   = document.getElementById('repeatButton');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let selectedSpeed = 1;

// Drag & drop setup (keep your existing code)
dropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    fileNameEl.textContent = file ? file.name : '';
});

// ... keep your dragenter, dragover, dragleave, drop handlers ...

// Listen for speed selection
document.querySelectorAll('input[name="speed"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        selectedSpeed = parseFloat(e.target.value);
    });
});

repeatBtn.addEventListener('click', processAudio);

async function processAudio() {
    const file = fileInput.files[0];
    const repeats = parseInt(document.getElementById('repeats').value);

    if (!file) return alert('Please select an audio file first.');
    if (isNaN(repeats) || repeats < 1) return alert('Please enter a number ≥ 1.');

    repeatBtn.disabled = true;
    download.style.display = 'none';
    previewSec.style.display = 'none';
    status.textContent = 'Starting...';
    status.className = 'processing';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Preparing...';

    try {
        status.textContent = 'Decoding audio...';
        progressText.textContent = 'Loading file...';

        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // ────────────────────────────────────────────────
        // Step 1: Apply speed change (time stretch)
        // ────────────────────────────────────────────────
        let processedBuffer = originalBuffer;

        if (selectedSpeed !== 1) {
            status.textContent = `Applying ${selectedSpeed}× speed...`;
            progressText.textContent = 'Time stretching...';

            const offlineSpeed = new OfflineAudioContext(
                originalBuffer.numberOfChannels,
                originalBuffer.length / selectedSpeed,
                originalBuffer.sampleRate
            );

            const sourceSpeed = offlineSpeed.createBufferSource();
            sourceSpeed.buffer = originalBuffer;
            sourceSpeed.playbackRate.value = selectedSpeed;
            sourceSpeed.connect(offlineSpeed.destination);
            sourceSpeed.start();

            processedBuffer = await offlineSpeed.startRendering();
        }

        // ────────────────────────────────────────────────
        // Step 2: Apply repeats
        // ────────────────────────────────────────────────
        status.textContent = 'Repeating audio...';
        progressText.textContent = 'Building final audio...';

        const totalSamples = processedBuffer.length * repeats;

        if (totalSamples > 100_000_000) {
            const approxMin = Math.round(totalSamples / processedBuffer.sampleRate / 60);
            if (!confirm(`Large output (~${approxMin} min). May be slow or crash tab. Continue?`)) {
                resetUI();
                return;
            }
        }

        const offlineRepeat = new OfflineAudioContext(
            processedBuffer.numberOfChannels,
            totalSamples,
            processedBuffer.sampleRate
        );

        const sourceRepeat = offlineRepeat.createBufferSource();
        sourceRepeat.buffer = processedBuffer;
        sourceRepeat.loop = true;
        sourceRepeat.connect(offlineRepeat.destination);

        sourceRepeat.start(0);
        sourceRepeat.stop(processedBuffer.duration * repeats);

        let progress = 10;
        progressFill.style.width = progress + '%';
        const interval = setInterval(() => {
            if (progress < 92) {
                progress += Math.random() * 6 + 3;
                progress = Math.min(progress, 92);
                progressFill.style.width = progress + '%';
            }
        }, 500);

        const finalBuffer = await offlineRepeat.startRendering();

        clearInterval(interval);
        progressFill.style.width = '100%';
        progressText.textContent = 'Finalizing file...';

        status.textContent = 'Creating download file...';
        const wavBlob = audioBufferToWav(finalBuffer);
        const url = URL.createObjectURL(wavBlob);

        audioPrev.src = url;
        previewSec.style.display = 'block';

        download.href = url;
        download.download = 'processed_audio.wav';
        download.style.display = 'block';

        status.textContent = `Done! (${selectedSpeed}× speed, ${repeats}× repeat)`;
        status.className = 'success';
        progressText.textContent = 'Ready to download';

    } catch (err) {
        console.error('Processing failed:', err);
        status.textContent = 'Error: ' + (err.message || 'Failed to process');
        status.className = 'error';
        progressText.textContent = 'Failed';
        alert('Error: ' + (err.message || 'Could not process the audio. Try a different file or lower repeats/speed.'));
    } finally {
        repeatBtn.disabled = false;
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 2000);
    }
}

function resetUI() {
    repeatBtn.disabled = false;
    progressContainer.style.display = 'none';
    status.textContent = '';
    status.className = '';
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * numChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * numChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
