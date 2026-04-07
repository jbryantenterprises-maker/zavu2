import { UIHelper } from './ui-helpers.js';

export class ModalHelpers {
  static showHowItWorks(): void {
    UIHelper.showElement('how-modal');
  }

  static hideHowItWorks(): void {
    UIHelper.hideElement('how-modal');
  }

  static copyCodeToClipboard(): void {
    const code = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    navigator.clipboard.writeText(code).then(() => 
      alert("🚀 Full working clone copied to clipboard!\n\nHost this file anywhere and you have your own private WeTransfer.")
    );
  }
}
