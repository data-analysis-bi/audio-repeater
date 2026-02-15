const dropArea     = document.getElementById('dropArea');
const fileInput    = document.getElementById('audioFile');
const fileNameEl   = document.getElementById('fileName');
const status       = document.getElementById('status');
const download     = document.getElementById('download');
const previewSec   = document.getElementById('previewSection');
const audioPrev    = document.getElementById('audioPreview');
const repeatBtn    = document.getElementById('repeatButton');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// Speed button logic
let selectedSpeed = 1;
document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSpeed = parseFloat(btn.dataset.speed);
    });
});

// Drag & drop
dropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    fileNameEl.textContent = file ? file.name : '';
});

// Drag events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => e.preventDefault() && e.stopPropagation(), false);
});

['dragenter', 'dragover'].forEach(evt => {
    dropArea.addEventListener(evt, () => dropArea.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, () => dropArea.classList.remove('dragover'), false);
});

dropArea.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        fileInput.files = e.dataTransfer.files;
        fileNameEl.textContent = file.name;
    } else {
        alert('Please drop an audio file.');
    }
});

repeatBtn.addEventListener('click', processAudio);

async function processAudio() {
    const file = fileInput.files[0];
    const repeats = parseInt(document.getElementById('repeats').value);

    if (!file) return alert('Please select an audio file first.');
    if (isNaN(repeats) || repeats < 1) return alert('Please enter a valid number of repeats ≥ 1.');

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
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);

        status.textContent = 'Processing (repeat + speed)...';
        progressText.textContent = 'Applying speed & repeats...';

        const totalDuration = originalBuffer.duration * repeats;
        const totalSamples = originalBuffer.length * repeats;

        if (totalSamples > 100_000_000) {
            const approxMin = Math.round(totalDuration / 60);
            if (!confirm(`Large result (~${approxMin} min). May take time or crash. Continue?`)) {
                resetUI();
                return;
            }
        }

        const offlineCtx = new OfflineAudioContext(
            originalBuffer.numberOfChannels,
            originalBuffer.length * repeats,
            originalBuffer.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.playbackRate.value = selectedSpeed;   // ← speed applied here
        source.loop = true;
        source.connect(offlineCtx.destination);

        source.start(0);
        source.stop(totalDuration / selectedSpeed);  // adjust stop time for speed

        // Progress simulation
        let progress = 5;
        progressFill.style.width = progress + '%';
        const interval = setInterval(() => {
            if (progress < 92) {
                progress += Math.random() * 6 + 3;
                progress = Math.min(progress, 92);
                progressFill.style.width = progress + '%';
            }
        }, 600);

        const renderedBuffer = await offlineCtx.startRendering();

        clearInterval(interval);
        progressFill.style.width = '100%';
        progressText.textContent = 'Creating file...';

        status.textContent = 'Finalizing...';
        const wavBlob = audioBufferToWav(renderedBuffer);
        const url = URL.createObjectURL(wavBlob);

        audioPrev.src = url;
        previewSec.style.display = 'block';

        download.href = url;
        download.download = `repeated_${selectedSpeed}x_${repeats}times.wav`;
        download.style.display = 'block';

        status.textContent = `Done! (${selectedSpeed}× speed, ${repeats}× repeat)`;
        status.className = 'success';
        progressText.textContent = 'Ready to download';

    } catch (err) {
        console.error(err);
        status.textContent = 'Error: ' + (err.message || 'Processing failed');
        status.className = 'error';
        progressText.textContent = 'Failed – check console (F12)';
        alert('Error: ' + (err.message || 'Could not process audio. Try smaller file/repeats.'));
    } finally {
        repeatBtn.disabled = false;
        setTimeout(() => progressContainer.style.display = 'none', 2000);
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
