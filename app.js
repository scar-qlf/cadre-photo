const stage = document.querySelector('#camera-stage');
const video = document.querySelector('#camera');
const canvas = document.querySelector('#capture-canvas');
const startButton = document.querySelector('#start-camera');
const flipButton = document.querySelector('#flip-camera');
const shutterButton = document.querySelector('#shutter');
const emptyTitle = document.querySelector('#empty-title');
const emptyCopy = document.querySelector('#empty-copy');
const guideLayer = document.querySelector('#guide-layer');
const ratioSelect = document.querySelector('#ratio-select');
const ratioBadge = document.querySelector('#ratio-badge');
const photoModal = document.querySelector('#photo-modal');
const helpModal = document.querySelector('#help-modal');
const capturedPhoto = document.querySelector('#captured-photo');
const saveButton = document.querySelector('#save-button');
const retakeButton = document.querySelector('#retake-button');

const looks = {
  natural: 'none',
  warm: 'sepia(0.19) saturate(1.13) contrast(1.04) brightness(1.025)',
  mono: 'grayscale(1) contrast(1.07)',
};

let cameraStream = null;
let facingMode = 'environment';
let selectedLook = 'natural';
let lastPhotoBlob = null;
let lastPhotoName = 'cadre-photo.jpg';

function setCameraMessage(title, copy) {
  emptyTitle.textContent = title;
  emptyCopy.textContent = copy;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage('Caméra indisponible', 'Ouvre cette page dans Safari après sa mise en ligne sécurisée.');
    return;
  }

  startButton.disabled = true;
  startButton.textContent = 'Ouverture de la caméra…';
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    video.srcObject = cameraStream;
    await video.play();
    stage.classList.add('is-live');
    flipButton.disabled = false;
    shutterButton.disabled = false;
    setCameraMessage('Prête quand tu l’es', 'Active la caméra pour voir ton cadrage.');
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
    setCameraMessage(denied ? 'Autorise la caméra' : 'Impossible d’ouvrir la caméra', denied
      ? 'Vérifie l’autorisation de la caméra dans les réglages de Safari.'
      : 'Essaie à nouveau ou vérifie que la caméra est disponible.');
  } finally {
    startButton.disabled = false;
    startButton.innerHTML = 'Réessayer <span aria-hidden="true">↗</span>';
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  video.srcObject = null;
}

function setGuide(mode) {
  const paths = {
    thirds: 'M33.33 0V100 M66.67 0V100 M0 33.33H100 M0 66.67H100',
    center: 'M50 0V100 M0 50H100',
    golden: 'M38.2 0V100 M61.8 0V100 M0 38.2H100 M0 61.8H100',
  };
  guideLayer.querySelector('path').setAttribute('d', paths[mode]);
  guideLayer.classList.toggle('guide-center', mode === 'center');
  guideLayer.classList.toggle('guide-golden', mode === 'golden');
  document.querySelectorAll('[data-guide]').forEach((button) => {
    const selected = button.dataset.guide === mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function setLook(look) {
  selectedLook = look;
  stage.classList.remove('look-warm', 'look-mono');
  if (look === 'warm') stage.classList.add('look-warm');
  if (look === 'mono') stage.classList.add('look-mono');
  document.querySelectorAll('[data-look]').forEach((button) => {
    const selected = button.dataset.look === look;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function currentAspectRatio() {
  return { portrait: 4 / 5, square: 1, landscape: 3 / 2 }[ratioSelect.value];
}

function updateRatio() {
  stage.classList.remove('ratio-portrait', 'ratio-square', 'ratio-landscape');
  stage.classList.add(`ratio-${ratioSelect.value}`);
  ratioBadge.textContent = { portrait: '4:5', square: '1:1', landscape: '3:2' }[ratioSelect.value];
}

function cropDimensions(sourceWidth, sourceHeight, targetRatio) {
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { sx: (sourceWidth - width) / 2, sy: 0, sw: width, sh: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - height) / 2, sw: sourceWidth, sh: height };
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) return;
  const aspect = currentAspectRatio();
  const source = cropDimensions(video.videoWidth, video.videoHeight, aspect);
  const outputHeight = 1500;
  const outputWidth = Math.round(outputHeight * aspect);
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  context.filter = looks[selectedLook];
  context.drawImage(video, source.sx, source.sy, source.sw, source.sh, 0, 0, outputWidth, outputHeight);
  context.filter = 'none';
  canvas.toBlob((blob) => {
    if (!blob) return;
    lastPhotoBlob = blob;
    lastPhotoName = `cadre-${new Date().toISOString().slice(0, 10)}.jpg`;
    capturedPhoto.src = URL.createObjectURL(blob);
    photoModal.showModal();
  }, 'image/jpeg', 0.94);
}

async function savePhoto() {
  if (!lastPhotoBlob) return;
  const photoFile = new File([lastPhotoBlob], lastPhotoName, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [photoFile] }) && navigator.share) {
    try {
      await navigator.share({ files: [photoFile], title: 'Ma photo Cadre' });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(lastPhotoBlob);
  link.download = lastPhotoName;
  link.click();
  URL.revokeObjectURL(link.href);
}

startButton.addEventListener('click', startCamera);
flipButton.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});
shutterButton.addEventListener('click', capturePhoto);
ratioSelect.addEventListener('change', updateRatio);
document.querySelectorAll('[data-guide]').forEach((button) => button.addEventListener('click', () => setGuide(button.dataset.guide)));
document.querySelectorAll('[data-look]').forEach((button) => button.addEventListener('click', () => setLook(button.dataset.look)));
document.querySelector('#help-button').addEventListener('click', () => helpModal.showModal());
saveButton.addEventListener('click', savePhoto);
retakeButton.addEventListener('click', () => photoModal.close());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
document.querySelectorAll('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));
photoModal.addEventListener('close', () => {
  if (capturedPhoto.src.startsWith('blob:')) URL.revokeObjectURL(capturedPhoto.src);
  capturedPhoto.removeAttribute('src');
});

updateRatio();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
