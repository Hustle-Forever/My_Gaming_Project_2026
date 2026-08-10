'use strict';

// Arabic speech-to-text via the Web Speech API (SpeechRecognition, ar-AE).
// Tapping the mic starts listening; the transcript fills the text box and is
// sent automatically. Unsupported browsers get a disabled mic with a hint.
(function () {
  const micBtn = document.getElementById('mic-btn');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.disabled = true;
    micBtn.title = 'الإدخال الصوتي غير مدعوم في هذا المتصفح — جرّب Chrome أو Safari';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'ar-AE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let recording = false;

  function setRecording(on) {
    recording = on;
    micBtn.classList.toggle('rec', on);
    micBtn.title = on ? 'جارٍ الاستماع… اضغط للإيقاف' : 'تحدّث بالعربي';
  }

  recognition.onresult = (event) => {
    const transcript = (event.results[0] && event.results[0][0].transcript || '').trim();
    if (!transcript) return;
    window.AppCommand.input.value = transcript;
    window.AppCommand.send(transcript);
  };

  recognition.onend = () => setRecording(false);

  recognition.onerror = (event) => {
    setRecording(false);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      window.AppCommand.notify('ما قدرت أوصل للمايك — اسمح للمتصفح باستخدام الميكروفون وحاول مرة ثانية');
    } else if (event.error === 'no-speech') {
      window.AppCommand.notify('ما سمعت شيء — اضغط المايك وتكلم بوضوح');
    } else if (event.error !== 'aborted') {
      window.AppCommand.notify('تعذّر التعرف على الصوت — جرب مرة ثانية أو اكتب طلبك');
    }
  };

  micBtn.addEventListener('click', () => {
    if (recording) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      setRecording(true);
    } catch (_) {
      setRecording(false);
    }
  });
})();
