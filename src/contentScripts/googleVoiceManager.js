/**
 * Create notification
 */
var showNotify;
var showScreen;
(function (){
	const styles = `
		#bulkSMS-screen {
			position: fixed;
			display: none;
			height: 100%;
			width: 100%;
			top: 0;
			left: 0;
			z-index: 9999;
		}
		
		#bulkSMS-notify {
			display: none;
		}
		
		#bulkSMS-notify .content {
			position: fixed;
			z-index: 9999;
			box-shadow: 0 1px 3px 0 rgba(60,64,67,0.302), 0 4px 8px 3px rgba(60,64,67,0.149);
			-webkit-font-smoothing: antialiased;
			font-family: Roboto,RobotoDraft,Helvetica,Arial,sans-serif;
			font-size: 16px;
			letter-spacing: .2px;
			-webkit-align-items: center;
			align-items: center;
			background-color: #202124;
			border: none;
			-webkit-border-radius: 4px;
			border-radius: 4px;
			bottom: 0;
			-webkit-box-sizing: border-box;
			box-sizing: border-box;
			color: #fff;
			display: -webkit-box;
			display: -webkit-flex;
			display: flex;
			-webkit-flex-wrap: wrap;
			flex-wrap: wrap;
			font-weight: 400;
			left: 0;
			margin: 24px;
			width: 180px;
			min-height: 52px;
			padding: 8px 24px;
			right: auto;
			text-align: left;
			top: auto;
			white-space: normal;
		}
	`;

	const cnt = `<div class='content'>
		<span class="wrap">
			<span class="next-send">Next send: </span>
			<span class="next-send-time">&nbsp;<span class="next-send-time">NaN</span>&nbsp;</span>
		</span>
	</div>`;
	
	const div = document.createElement('div');
	div.setAttribute('id', 'bulkSMS-notify');
	div.innerHTML = cnt;
	document.body.appendChild(div);
	
	const screen = document.createElement('div');
	screen.setAttribute('id', 'bulkSMS-screen');
	document.body.appendChild(screen);
	
	addStyle(styles, 'bulkSMS');
	
	var timer;
	function updateTime(time){
		div.querySelector('.next-send-time').innerText = time >= 1000 ? Math.floor(time/1000) + " s" : time + " ms";
	}
	function startTimeout(time){
		updateTime(time);
		timer = setTimeout(() => {
			time -= 1000;
			if (time > 0) return startTimeout(time);
			showNotify(false);
		}, 1000)
	}
	
	showNotify = function(time){
		if (time === false) {
			if (timer !== undefined) clearTimeout(timer);
			return div.setAttribute('style', 'display: none');
		}
		//
		div.setAttribute('style', 'display: block');
		startTimeout(time);
	}
	
	showScreen = function(b){
		return screen.setAttribute('style', b === false ? 'display: none' : 'display: block');
	}
	
})()

/**
 * Gets a random time in ms between min and max for waiting
 * @return {Number}
 */
function getRandomWaitTime2(min, max) {
	return Math.floor(Math.random() * (max-min)) + min;
}
/**
 * Pattern 1 for sending messages: randomly interval 1 s - 30 s between sends.
 */
function delayPatternFn1(){
	var count = 0;
	const t1 = 1*1000;
	const t2 = 30*1000;
	
	return () => getRandomWaitTime2(t1, t2);
}
/**
 * Pattern 2 for sending messages: randomly interval 200 ms - 2 s between sends. Pause for 1 minutes after 20 messages.
 */
function delayPatternFn2(){
	var counter = 0;
	const groupSize = 20; //pause for 1 minutes after each 20 contacts.
	const shortDelay = 2*1000; //2 s
	const longDelay = 1*60*1000; //1 min

	return function(){
		if (counter <= groupSize) return (counter++, getRandomWaitTime2(200, shortDelay));
		return (counter = 0, longDelay);
	}
}
const patterns = {
	0: function() { return () => getRandomWaitTimeMS(6000) },
	1: delayPatternFn1,
	2: delayPatternFn2,
}
/**
 * This runs on voice.google.com
 */
class GoogleVoiceSiteManager {
	constructor() {
		this.messagesToSend = {};
		this.numberQueue = [];
		this.currentNumberSending = '';
		this.delayPattern = null;
	}

	initialize() {
		var that = this;

		chrome.runtime.onMessage.addListener(function (message, sender, response) {
			if (message.from === 'popup' && message.type === 'SEND_MESSAGES') {
				//get message content
				that.addMessagesToQueue(message.messages);
				
				//get sending pattern
				that.delayPattern = patterns[message.messages.delayer || 0]();
				
				// switch To Text View
				document.querySelector(selectors.gvMessagesTab).click();

				that.sendFromQueue();
			}

			if (message.from === 'popup' && message.type === 'CHECK_GOOGLE_VOICE_SUPPORT') {
				var url = window.location.href;
				response(url.startsWith('https://voice.google.com/') ? 'GV' : false);
			}
		});
	}

	addMessagesToQueue(messages) {
		Object.assign(this.messagesToSend, messages.messages);
		this.numberQueue = this.numberQueue.concat(messages.queue);
	}

	async sendFromQueue() {
		let retryCount = 5;
		let verifyOnly = false;

		if (this.numberQueue.length > 0) {
			showScreen();
			this.currentNumberSending = this.numberQueue.shift();

			let sendExecutionQueue = this.getSendExecutionQueue();
			while (sendExecutionQueue.length) {
				let currentStep = sendExecutionQueue.shift().bind(this);
				const result = await keepTryingAsPromised(currentStep, retryCount > 0);
				if (!result) {
					console.log(`Bulk SMS - Step failed (${getFunctionName(currentStep)}), retrying message.`);
					retryCount--; // if this keeps happening, alert on it

					if (verifyOnly) {
						sendExecutionQueue = this.getVerificationOnlyExecutionQueue();
					} else {
						// otherwise start over in the execution queue
						sendExecutionQueue = this.getSendExecutionQueue();
					}
				}
				if (getFunctionName(currentStep) === 'sendMessage') {
					verifyOnly = true; // we don't want to risk sending a message twice
				}
			}
		}
	}

	getSendExecutionQueue() {
		return [
			this.showNumberInput,
			this.fillNumberInput,
			this.startChat,
			this.confirmChatSwitched,
			this.writeMessage,
			this.sendMessage,
			this.confirmThreadHeaderUpdated,
			this.confirmSent
		];
	}

	// opens up the chat again and checks if the message was sent previously
	getVerificationOnlyExecutionQueue() {
		return [
			this.showNumberInput,
			this.fillNumberInput,
			this.startChat,
			this.confirmChatSwitched,
			this.confirmSent
		];
	}

	showNumberInput() {
		var showInputButton = document.querySelector(selectors.gvNumInputButton);
		if (showInputButton && showInputButton.offsetParent !== null) {
			showInputButton.click();
			return true;
		}
	}

	fillNumberInput() {
		let numInput = document.querySelector(selectors.gvNumInput);
		if (numInput && numInput.offsetParent !== null) {
			numInput.value = this.currentNumberSending;

			// this fires the necessary events for Google Voice to pick up
			numInput.focus();
			numInput.select();
			document.execCommand('cut');
			document.execCommand('paste');

			// confirm that the number was added as expected
			let numInputConfirm = document.querySelector(selectors.gvNumInput);
			return numInputConfirm && numInputConfirm.value === this.currentNumberSending;
		}
	}

	// clicks the "start SMS" button on the number dropdown
	startChat() {
		var startChatButton = document.querySelector(selectors.gvStartChatButton);
		if (startChatButton && startChatButton.offsetParent !== null) {
			startChatButton.click();
			return true;
		}
	}

	confirmChatSwitched() {
		const numberToSend = this.currentNumberSending;
		const recipientButton = document.querySelector(selectors.gvRecipientButton);
		if (recipientButton && recipientButton.offsetParent !== null) {
			var number = formatNumber(recipientButton.innerText);
			return numberToSend === number;
		}
	}

	writeMessage() {
		const number = this.currentNumberSending;
		if (!this.messagesToSend[number]) {
			return false;
		}

		const message = this.messagesToSend[number];

		var messageEditor = document.querySelector(selectors.gvMessageEditor);

		if (messageEditor.value && messageEditor.value !== message) {
			console.log('Bulk SMS - Already had value:', messageEditor.value);
			return;
		}

		if (messageEditor && messageEditor.offsetParent !== null) {
			messageEditor.value = message;
			return true;
		}
	}

	sendMessage() {
		var messageEditor = document.querySelector(selectors.gvMessageEditor);
		if (!messageEditor) {
			return;
		}

		messageEditor.focus();
		messageEditor.select();
		document.execCommand('cut');
		document.execCommand('paste');

		// click send button
		let sendButtonOld = document.querySelector(selectors.gvSendButtonOld);
		let sendButtonNew = document.querySelector(selectors.gvSendButtonNew);
		if (sendButtonOld && sendButtonOld.offsetParent !== null && sendButtonOld.getAttribute('aria-disabled') === 'false') {
			sendButtonOld.click();
			return true;
		}
		if (sendButtonNew && sendButtonNew.offsetParent !== null && sendButtonNew.disabled === false) {
			sendButtonNew.dispatchEvent(new Event('mousedown'));
			sendButtonNew.dispatchEvent(new Event('mouseup'));
			sendButtonNew.click();
			return true;
		}
	}

	confirmThreadHeaderUpdated() {
		let chatLoadedHeader = document.querySelector(selectors.gvChatLoadedHeader); // the header switches to this after sending is complete. If we move on before this, it can break things.
		if (chatLoadedHeader) {
			return true;
		}
	}

	confirmSent() {
		let sendingNote = document.querySelector(selectors.gvSendingNote); // this is the note that says "Sending", it will disappear when it is finished

		if (!sendingNote) {
			// check if the message we sent is showing up in the chat window
			let mostRecentMessages = document.querySelectorAll(selectors.gvMostRecentMessages);
			let	sentMessageIsThreaded = false;
			if (mostRecentMessages && mostRecentMessages.length) {
				var i = mostRecentMessages.length - 1;
				for (i; !sentMessageIsThreaded && i >= 0; i--) {
					let mostRecentMessage = mostRecentMessages[mostRecentMessages.length - 1];
					sentMessageIsThreaded = mostRecentMessage.innerText === this.messagesToSend[this.currentNumberSending];
				}
			}

			if (sentMessageIsThreaded) {
				logEvent({
					eventLabel: 'MESSAGE_SENT',
					eventValue: 1
				});
				// continue with queue
				showScreen(false); //screen off
				if (this.numberQueue.length > 0) {
					const timeBeforeNextMessage = this.delayPattern();
					showNotify(timeBeforeNextMessage);
					setTimeout(() => {
						showNotify(false);
						this.sendFromQueue();
					}, timeBeforeNextMessage);
				}
				return true;
			}
		}
	}
}
