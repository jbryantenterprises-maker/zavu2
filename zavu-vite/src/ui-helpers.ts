import QRCode from 'qrcode';

export class UIHelper {
  static showElement(id: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.classList.remove('hidden');
    }
  }

  static hideElement(id: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.classList.add('hidden');
    }
  }

  static updateElement(id: string, content: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = content;
    }
  }

  static updateElementText(id: string, text: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  static setProgressBar(id: string, percentage: number): void {
    const element = document.getElementById(id);
    if (element) {
      element.style.width = `${percentage}%`;
    }
  }

  static copyToClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
  }

  static async copyLink(linkElementId: string): Promise<void> {
    const linkElement = document.getElementById(linkElementId);
    if (linkElement) {
      const text = linkElement.textContent?.trim() || '';
      await this.copyToClipboard(text);
    }
  }

  static emailLink(link: string): void {
    const subject = encodeURIComponent("I sent you a file via Xavu (no servers!)");
    const body = encodeURIComponent(`Hey!\n\nI just created a direct P2P link for you. Click it while I have the tab open:\n\n${link}\n\nFile will transfer straight from my browser to yours. No cloud. No storage.\n\nEnjoy!`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  static emailCloudLink(links: string[]): void {
    const subject = encodeURIComponent("I sent you a file via Xavu");
    const linkList = links.join('\n');
    const plural = links.length > 1 ? 's are' : ' is';
    const body = encodeURIComponent(`Hey!\n\nI uploaded a file for you. Use the link${links.length > 1 ? 's' : ''} below to download:\n\n${linkList}\n\nThe link${plural} valid for 7 days. Files are end-to-end encrypted — no one else can access them.\n\nEnjoy!`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  static showQRCode(canvasId: string, link: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
      if (canvas) {
        QRCode.toCanvas(canvas, link, { width: 280, margin: 2 }, (error: Error | null | undefined) => {
          if (error) reject(error);
          else resolve();
        });
      }
    });
  }

  static addClass(elementId: string, ...classNames: string[]): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add(...classNames);
    }
  }

  static removeClass(elementId: string, ...classNames: string[]): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove(...classNames);
    }
  }
    static confettiBurst(): void {
    const colors = ['#00ff9d', '#00b36b', '#ffffff'];
    for (let i = 0; i < 80; i++) {
      const confetti = document.createElement('div');
      confetti.style.position = 'fixed';
      confetti.style.zIndex = '99999';
      confetti.style.left = Math.random() * 100 + 'vw';
      confetti.style.top = '-20px';
      confetti.style.width = '12px';
      confetti.style.height = '12px';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
      confetti.style.opacity = Math.random().toString();
      document.body.appendChild(confetti);

      const animationTime = Math.random() * 3000 + 2000;
      confetti.animate([
        { transform: `translateY(0) rotate(0deg)` },
        { transform: `translateY(${window.innerHeight + 100}px) rotate(${Math.random() * 800}deg)` }
      ], {
        duration: animationTime,
        easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)'
      });

      setTimeout(() => confetti.remove(), animationTime);
    }
  }
}
