const canvas = document.getElementById("mesh");
const context = canvas.getContext("2d");

function draw() {
  const width = 1920;
  const height = 1080;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const time = performance.now() / 1000;
  context.lineWidth = 1;
  for (let i = 0; i < 28; i += 1) {
    const y = 120 + i * 34 + Math.sin(time + i * 0.33) * 6;
    context.strokeStyle = i % 3 === 0 ? "rgba(47,111,237,0.07)" : "rgba(23,32,51,0.045)";
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(480, y + Math.sin(time + i) * 18, 1280, y - 22, width, y + 8);
    context.stroke();
  }

  for (let i = 0; i < 20; i += 1) {
    const x = 120 + i * 88 + Math.cos(time * 0.7 + i) * 8;
    context.strokeStyle = "rgba(21,163,109,0.035)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + Math.sin(time + i) * 18, height);
    context.stroke();
  }

  requestAnimationFrame(draw);
}

draw();
