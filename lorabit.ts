/**
 * 
 * Extension block for lorabit LoRaWAN I2C-Device
 * Itti Srisumalai: 2019
 * 
 */

const enum loraBit_freq_Plan {
	//% block=AS923
	AS923 = 0,
};

const enum loraJoin_Mode {
	//% block=ABP
	ABP = 0,
	//% block=OTAA
	OTAA = 1,
};

const enum loraBit_Confirmed {
	//% block=Uncomfirmed
	Uncomfirmed,
	//% block=Confirmed
	Confirmed,
};

const enum loraBit_ADR {
	//% block=Off
	Off = 0,
	//% block=On
	On = 1,
};

const enum loraJoin_State {
	RESET = 0,
	NOT_JOINED = 1,
	JOINING = 2,
	JOINED = 3,
	JOIN_FAIL = 4,
};

const enum loraBit_Event {
	UNKNOWN = -1,
	RESET = 0,
	INITED = 1,
	JOINING = 2,
	JOINED = 4,
	JOIN_FAIL = 8,    //JOIN_FAIL = 4,  JOIN_DENIED = 4,
	TX_COMPLETE = 16,
	ACK_NOT_RECEIVED = 32,
	TXRXPEND = 128,
}

const enum loraBit_Cmd {
	GET_STATUS = 1,
	RESET,
	JOIN,
	SEND,
	SET_BUF_PTR,
	GET_BUF_LEN,
	GET_BUF_DATA,
	SLEEP = 15,

	CONFIG = 16,
	DEVEUI_REG,
	APPEUI_REG,
	APPKEY_REG,

	DEVADDR_REG = 33,
	NWKSKEY_REG,
	APPSKEY_REG,
	NETID_REG,
}

const enum loraBit_Reg {
	RX_REG = 1,
	TIMER_REG,
	DEVADDR_REG,
}

const enum Verbose_Mode {
	//% block=Off
	Off = 0,
	//% block=On
	On = 1,
};

const enum Running_State {
	RUN = 0,
	PENDING = -1,
	SLEEP = 1
};

/**
 * Custom blocks uf1eb
 */
//% color=#0071bc icon="\uf012" weight=96
namespace loraBit {

	//%
	function byteToHexString(value: number): string {
		return (("0123456789ABCDEF"[value >> 4]) + ("0123456789ABCDEF"[value & 0xF]))
	}

	//%
	function HexStringToVal(text: string): Buffer {
		let boffset = text.length % 2
		let len = (text.length / 2) + boffset
		let temp = pins.createBuffer(len)

		let b = 0
		let h = 0
		let offset = 0
		let v = 0

		for (let i = 0; i < text.length; i++) {
			h = text.charCodeAt(i)

			if ((h >= 48) && (h <= 57))         //'0' - '9'
				offset = 48
			else if ((h >= 65) && (h <= 70))    //'A' - 'F'
				offset = 55
			else if ((h >= 97) && (h <= 102))   //'a' - 'f'
				offset = 87
			else
				offset = h

			if (((i + boffset) % 2) != 0) {
				temp[b] = v | (h - offset)  //temp.setNumber(NumberFormat.UInt8LE, b, v | (h - offset));
				b++;
			} else
				v = (h - offset) << 4
		}

		return temp
	}

	const I2C_ADDR: number = 0x63
	const LORA_EVENT_ID: number = 8888
	const RX_PAYLOAD_MAX_LEN: number = 32
	const TX_TIMEOUT_1: number = 300000   //mSec
	const TX_TIMEOUT_2: number = 600000   //mSec

	let joinMode: number = loraJoin_Mode.OTAA
	let ReceivedPort: number = 0
	let ReceivedPayload: string = "0123456789ABCDEF0123456789ABCDEF"

	let config = (1 * 64) + (5 % 8) * 8 + (2 % 8)    //(joinMode * 128) + 
	let APPEUI: Buffer = pins.createBuffer(8); APPEUI.fill(0);
	let DEVEUI: Buffer = pins.createBuffer(8); DEVEUI.fill(0);
	let APPKEY: Buffer = pins.createBuffer(16); APPKEY.fill(0);
	let NETID: number = 19  //TTN Network ID
	let DEVADDR: Buffer = pins.createBuffer(4); DEVADDR.fill(0);
	let NWKSKEY: Buffer = pins.createBuffer(16); NWKSKEY.fill(0);
	let APPSKEY: Buffer = pins.createBuffer(16); APPSKEY.fill(0);

	let pause: boolean = false
	let txrxpend: boolean = false
	let pending: number = 0
	let rxWindows: boolean = false
	let joinState: number = loraJoin_State.JOINED
	let rejoin: boolean = false
	let nack: number = 0
	let txto: number = input.runningTime() + TX_TIMEOUT_2    // TX,Rejoin timout
	let verbose = Verbose_Mode.Off
	let sleepmode: number = Running_State.RUN

	//%
	function timer_reset(ms = 300000) {
		txto = input.runningTime() + ms
	}

	function timeout(): boolean {
		//console.log(input.runningTime().toString())
		//console.log(txto.toString())
		if (input.runningTime() > txto)
			return (true)
		return (false)
	}

	function msg(m: string) {
		if (verbose == Verbose_Mode.On)
			console.log(m)
	}

	function readByte(register: number): number {
		let cmd: Buffer = pins.createBuffer(1)
		let temp: Buffer = pins.createBuffer(1)
		cmd[0] = register
		pins.i2cWriteBuffer(I2C_ADDR, cmd, false)
		temp = pins.i2cReadBuffer(I2C_ADDR, 1, false)
		return temp[0]
	}

	function readBuffer(len: number): Buffer {
		let cmd: Buffer = pins.createBuffer(1)
		let temp: Buffer = pins.createBuffer(len)
		let x: number
		cmd[0] = loraBit_Cmd.GET_BUF_DATA
		pins.i2cWriteBuffer(I2C_ADDR, cmd, false)
		for (x = 0; x < len; x++) {
			cmd = pins.i2cReadBuffer(I2C_ADDR, 1, false)
			temp[x] = cmd[0]
		}
		return temp
	}

	//%
	function writeByte(register: number, value: number): void {
		let temp: Buffer = pins.createBuffer(2);
		temp[0] = register;
		temp[1] = value;
		pins.i2cWriteBuffer(I2C_ADDR, temp, false);
		basic.pause(100)
	}

	//%
	function writeBuffer(register: number, buf: Buffer): void {
		let temp: Buffer = pins.createBuffer(buf.length + 1);
		let x: number
		temp[0] = register;
		for (x = 0; x < buf.length; x++)
			temp[x + 1] = buf[x]
		pins.i2cWriteBuffer(I2C_ADDR, temp, false);
		basic.pause(100)
	}

	//%
	function getStatus(): number {
		return readByte(loraBit_Cmd.GET_STATUS)
	}

	//%
	function wakeup(): void {
		if (sleepmode != Running_State.RUN) {
			if (sleepmode == Running_State.SLEEP) {
				while (!timeout())
					basic.pause(100)
			}
			sleepmode = Running_State.RUN
			timer_reset()
			msg(">Wake up")
		}
	}

	control.inBackground(() => {
		let s0 = loraBit_Event.UNKNOWN
		let s = s0
		let rxbuffer: Buffer = pins.createBuffer(RX_PAYLOAD_MAX_LEN)
		let tmp: Buffer = pins.createBuffer(1)
		let i = 0
		let len = 0
		let dlmsg = ''

		while (true) {

			do {
				basic.pause(50)

				if (pending > 0)
					pause = true
				else if (sleepmode == Running_State.SLEEP)
					s0 = loraBit_Event.UNKNOWN

			} while (!txrxpend || (pending > 0))

			if (timeout()) {
				txrxpend = false
				timer_reset()

				joinState = loraJoin_State.NOT_JOINED
				s0 = loraBit_Event.UNKNOWN
				msg(">NOT JOINED")
				msg(">WAIT JOIN")
			}

			s = getStatus()

			if (s != s0) {
				//console.log(s.toString())
				s0 = s
				if (!(s == loraBit_Event.RESET || (s & loraBit_Event.TXRXPEND) != 0)) {
					if (joinState != loraJoin_State.JOINED) { // RESET) || NOT_JOINED) || JOIN_FAIL
						if (s & loraBit_Event.JOINED) {
							joinState = loraJoin_State.JOINED
							txrxpend = false
							timer_reset()
							tmp[0] = config + (joinMode * 128)
							writeBuffer(loraBit_Cmd.CONFIG, tmp)
							msg("EV_JOINED")
						}
						else if (s & loraBit_Event.JOINING) {
							joinState = loraJoin_State.JOINING
							msg("EV_JOINING")
						}
					}
					else {
						if (!(s & loraBit_Event.JOINED)) {
							if (s & loraBit_Event.JOIN_FAIL) {
								joinState = loraJoin_State.JOIN_FAIL
								timer_reset()
								msg("EV_JOIN_FAILED")
								msg(">WAIT REJOIN")

							}
							else {
								joinState = loraJoin_State.NOT_JOINED
								timer_reset()
								msg(">NOT JOINED")
								msg(">WAIT JOIN")
							}
						}
						else if (txrxpend) {
							if (s & loraBit_Event.TX_COMPLETE) {
								dlmsg = ""
								ReceivedPort = 0
								ReceivedPayload = ""

								if (s & loraBit_Event.ACK_NOT_RECEIVED) {
									nack = 1
									dlmsg = ",NA"
								}
								else {
									writeByte(loraBit_Cmd.SET_BUF_PTR, loraBit_Reg.RX_REG)
									len = readByte(loraBit_Cmd.GET_BUF_LEN)
									//console.log(len.toString())
									if (len > 0) {
										dlmsg = ",A"
										if (len > RX_PAYLOAD_MAX_LEN)
											len = RX_PAYLOAD_MAX_LEN
										rxbuffer = readBuffer(len)
										ReceivedPort = rxbuffer[0]
										if (len > 1) {
											for (i = 0; i < len - 1; i++)
											ReceivedPayload = ReceivedPayload + byteToHexString(rxbuffer[i + 1])
											dlmsg = dlmsg + "," + byteToHexString(ReceivedPort) + "," + ReceivedPayload
										}
									}
								}
								txrxpend = false
								timer_reset()

								if (rxWindows && ((nack != 0) || (len > 0)))
									control.raiseEvent(LORA_EVENT_ID, 1)

								msg("EV_TXCOMPLETE" + dlmsg)
								if (sleepmode == Running_State.PENDING) {
									sleepmode = Running_State.SLEEP
									writeByte(loraBit_Cmd.SLEEP, 0)
									timer_reset(2000)
									msg(">Sleep Mode")
								}
							}//TX_COMPLETE
						}//txrxpend
					}
				}
			} //s!=s0
		}
	})

	//%
	function do_reset(): boolean {
		let s: number
		let t1: number
		let t0: number = 5 //times
		let r = false

		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		msg(">RESET")
		do {
			writeByte(loraBit_Cmd.RESET, 0)

			t1 = 100   //10s
			do {
				basic.pause(100)
				s = getStatus()
				t1--
			} while ((s != loraBit_Event.INITED) && (t1 > 0))

			t0--
		} while ((s != loraBit_Event.INITED) && (t0 > 0))


		if (s == loraBit_Event.INITED) {
			r = true
			msg("EV_RESET")
		}

		pending = pending - 1
		return (r)
	}

	/**
	 * Reset loraBit
	 */
	//% subcategory=Settings
	//% weight=100
	//% blockId="LoraBit_reset"
	//% block="Reset loraBit"
	export function reset(): void {
		wakeup()
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		if (do_reset())
			joinState = loraJoin_State.RESET

		ReceivedPort = 0
		ReceivedPayload = ""

		txrxpend = false
		timer_reset()

		pending = 0
	}

	//%
	function do_config(): void {
		let tmp = pins.createBuffer(1)
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		tmp[0] = config + (joinMode * 128)
		writeBuffer(loraBit_Cmd.CONFIG, tmp)
		pending = pending - 1
	}

	/**
	* Set Verbose mode
	* @param mode
	*/
	//% subcategory=Settings
	//% weight=99
	//% help=loraBit/Verbose
	//% blockId="loraBit_Verbose"
	//% block="Set Verbose |mode %mode"
	//% mode.defl=Verbose_Mode.On
	export function Verbose(mode: Verbose_Mode): void {
		verbose = mode
	}

	/**
	* Set Configuration Parameter for The Air Authentication (OTAA)
	* @param Datarate[0-6]
	* @param Retrans[0-7]
	* @param ADR
	*/
	//% subcategory=Settings
	//% weight=99
	//% help=loraBit/param_Config
	//% blockId="loraBit_param_Config"
	//% block="Set Configuration Parameter|Data Rate %Datarate|Retransmissions %Retrans|Adaptative Data Rate %ADR"
	//% Datarate.min=0 Datarate.max=6 Datarate.defl=2
	//% Retrans.min=0 Retrans.max=7 Retrans.defl=5
	//% ADR.defl=Off
	//% inlineInputMode=external
	export function param_Config(Datarate: number, Retrans: number, ADR: loraBit_ADR): void {
		wakeup()
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		config = (ADR * 64) + (Retrans % 8) * 8 + (Datarate % 8)
		do_config()
		txrxpend = false
		timer_reset()
		pending = pending - 1
	}

	/**
	 * Set Join Parameter for The Air Authentication (OTAA)
	 * @param DevEUI Device EUI Unique 8 bytes, Hexstring BE
	 * @param AppEUI Application EUI Unique 8 bytes, Hexstring BE
	 * @param AppKey AppKey 16 bytes, Hexstring BE
	 */
	//% subcategory=Settings
	//% weight=99
	//% help=loraBit/param_OTAA
	//% blockId="loraBit_param_OTAA"
	//% block="Set Join Parameter|Device EUI %DevEUI|Application EUI %AppEUI|App Key %AppKey"
	//% DevEUI.defl="0011223344556677" AppEUI.defl="0011223344556677" AppKey.defl="00112233445566778899AABBCCDDEEFF"
	export function param_OTAA(DevEUI: string, AppEUI: string, AppKey: string, dummy = 0): void {
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		DEVEUI = HexStringToVal(DevEUI)
		APPEUI = HexStringToVal(AppEUI)
		APPKEY = HexStringToVal(AppKey)
		joinMode = 1
		rejoin = true
		pending = pending - 1
	}

	/**
	 * Set Parameter for activating a device by personalization (ABP)
	 * @param DevAddr Device Address Unique 4 bytes, Hexstring BE
	 * @param NwkSKey Network Session Key 16 bytes, Hexstring BE
	 * @param AppSKey App Session Key 16 bytes, Hexstring BE
	 */
	//% subcategory=Settings
	//% weight=98
	//% help=loraBit/param_ABP
	//% blockId="loraBit_param_ABP"
	//% block="Set Session Parameter|Device Address %DevAddr|Network Session Key %NwkSKey|App Session Key %AppSKey"
	//% DevAddr.defl="00112233" NwkSKey.defl="00112233445566778899AABBCCDDEEFF" AppSKey.defl="00112233445566778899AABBCCDDEEFF"
	export function param_ABP(DevAddr: string, NwkSKey: string, AppSKey: string, NetID = 19): void {
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		DEVADDR = HexStringToVal(DevAddr)
		NWKSKEY = HexStringToVal(NwkSKey)
		APPSKEY = HexStringToVal(AppSKey)
		NETID = NetID
		joinMode = 0
		rejoin = true
		pending = pending - 1
	}

	//%
	function do_join(): void {
		let s: number
		let tmp: Buffer
		let timeout: number

		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		if (joinState != loraJoin_State.RESET)
			if (do_reset()) joinState = loraJoin_State.RESET

		if (joinState == loraJoin_State.RESET) {
			msg(">JOIN")

			let tmp = pins.createBuffer(1)
			tmp[0] = config + (joinMode * 128)
			writeBuffer(loraBit_Cmd.CONFIG, tmp)

			if (rejoin) {
				if (joinMode == loraJoin_Mode.ABP) {
					writeBuffer(loraBit_Cmd.DEVADDR_REG, DEVADDR)
					writeBuffer(loraBit_Cmd.NWKSKEY_REG, NWKSKEY)
					writeBuffer(loraBit_Cmd.APPSKEY_REG, APPSKEY)

					tmp = pins.createBuffer(4)
					tmp.setNumber(NumberFormat.UInt32LE, 1, NETID);
					writeBuffer(loraBit_Cmd.NETID_REG, tmp)
				}
				else {
					writeBuffer(loraBit_Cmd.DEVEUI_REG, DEVEUI)
					writeBuffer(loraBit_Cmd.APPEUI_REG, APPEUI)
					writeBuffer(loraBit_Cmd.APPKEY_REG, APPKEY)
				}
			}

			writeByte(loraBit_Cmd.JOIN, 0)
			//console.log("EV_JOINING")
		}
		pending = pending - 1
	}

	/**
	 * Join network
	 */
	//% subcategory=Settings
	//% weight=100
	//% help=loraBit/join
	//% blockId="loraBit_join"
	//% block="Join Network|%freq"
	//% freq.defl=loraBit_freq_Plan.AS923
	export function join(freq: loraBit_freq_Plan = loraBit_freq_Plan.AS923): void {
		wakeup()
		pause = false
		pending = pending + 1
		while (!pause)
			basic.pause(100)

		if (joinState == loraJoin_State.RESET) {
			do_join()

			rejoin = false
			ReceivedPort = 0
			ReceivedPayload = ""

			timer_reset(TX_TIMEOUT_2)
			txrxpend = true
		}
		pending = pending - 1
	}

	/**
	 * When receive a LoRa packet
	 * @param handler code to run
	 */
	//% weight=98
	//% blockId="loraBit_whenReceived"
	//% block="When Receive"
	export function whenReceived(handler: Action): void {
		rxWindows = true
		control.onEvent(LORA_EVENT_ID, 1, handler)
	}

	/**
	 * is Joined
	 */
	//% weight=98
	//% blockId="loraBit_joined"
	//% block="Joined"
	//% icon="\uf085"
	export function joined(): boolean {
		if (joinState == loraJoin_State.JOINED)
			return true
		return false
	}

	/**
	 * is Not Acknowledged
	 */
	//% weight=98
	//% blockId="loraBit_nacknowledged"
	//% block="Not Acknowledged"
	//% icon="\uf085"
	export function nacknowledged(): boolean {
		if (nack == 1)
			return true
		return false
	}

	/**
	 * Available
	 */
	//% weight=98
	//% blockId="loraBit_available"
	//% block="available"
	//% icon="\uf085"
	export function available(): boolean {
		if (!txrxpend)	// && (joinState == loraJoin_State.JOINED))
			return true
		return false
	}

	/**
	 * Received Payload Hextstring
	 */
	//% weight=98
	//% blockId="loraBit_getReceivedPayload"
	//% block="Received Payload"
	//% icon="\uf085"
	export function getReceivedPayload(): string {
		return ReceivedPayload
	}

	/**
	 * Received Port
	 */
	//% weight=98
	//% blockId="loraBit_getReceivedPort"
	//% block="Received Port"
	//% icon="\uf085"
	export function getReceivedPort(): number {
		return ReceivedPort
	}

	/**
		 * Enter sleep mode
		 * @param none
		 */
	//% weight=99
	//% help=loraBit/sleep
	//% blockId="loraBit_sleep"
	//% block="Sleep"
	export function sleep(): void {
		if (txrxpend || (pending > 0))
			sleepmode = Running_State.PENDING
		else {
			pause = false
			pending = pending + 1
			while (!pause) 
				basic.pause(100)
		
			writeByte(loraBit_Cmd.SLEEP, 0)
			sleepmode = Running_State.SLEEP
			timer_reset(2000)
			msg(">Sleep Mode")
			pending = pending - 1
		}
	}

	/**
	 * Send Confirmed/Unconfirmed LoRaWAN packet
	 * @param confirmed Confirm
	 * @param port LoRaWAN Port
	 * @param payload Hex String
	 */
	//% weight=99
	//% help=loraBit/sendPacket
	//% blockId="loraBit_sendPacket"
	//% block="Transmitt %confirmed| at Port %port| with Payload %payload"
	//% port.min=1 port.max=253
	//% port.defl=1
	//% payload.defl="48656c6c6f2c20576f726c6421"
	//% confirmed.defl=loraBit_Confirmed.Uncomfirmed
	export function sendPacket(confirmed: loraBit_Confirmed, port: number, payload: string): void {
		wakeup()
		if (txrxpend || (pending > 0))
			msg("OP_TXRXPEND")
		else {
			pause = false
			pending = pending + 1
			while (!pause)
				basic.pause(100)

			if (rejoin)
				msg(">Send packet: Join require")
			else {
				if (joinState != loraJoin_State.JOINED) {
					if (joinState == loraJoin_State.JOINING)
						msg(">Send packet: Wait joining")
					else {
						do_join()
						rejoin = false
						timer_reset(TX_TIMEOUT_2)
						txrxpend = true
					}
				}
				else {

					let len = (payload.length / 2) + (payload.length % 2)
					let buf: Buffer = pins.createBuffer(2 + len)

					nack = 0

					if (confirmed == loraBit_Confirmed.Uncomfirmed)
						buf[0] = 0
					else {
						nack = -1
						buf[0] = 1
					}

					buf[1] = port

					let tmp: Buffer
					tmp = HexStringToVal(payload);
					for (let i = 0; i < tmp.length; i++)
						buf[i + 2] = tmp[i]

					writeBuffer(loraBit_Cmd.SEND, buf);
					ReceivedPort = 0
					ReceivedPayload = ""
					timer_reset()
					txrxpend = true
					msg(">Send packet")
				}
			}

			pending = pending - 1
		}
	}

	/**
	 * Pack Text to HexString.
	 * @param text to convert, eg: "Hello"
	 */
	//% weight=98
	//% help=loraBit/packHexString
	//% blockId="loraBit_packHexString"
	//% block="Convert|%text to hex string"
	//% icon="\uf085"
	//% text.defl="Hello, World!"
	export function packHexString(text: string): string {
		let hexstr = ""
		for (let i = 0; i < text.length; i++)
			hexstr = hexstr + byteToHexString(text.charCodeAt(i))
		return hexstr
	}

	/**
	 * Unpack Hexstring to Text.
	 * @param text to convert, eg: "313233414243" -> "123ABC"
	 */
	//% weight=98
	//% help=loraBit/unpackHexString
	//% blockId="loraBit_unpackHexString"
	//% block="Convert hex string|%text to text"
	//% icon="\uf085"
	//% text.defl="313233414243"
	export function unpackHexString(text: string): string {
		let str = ""
		let temp: Buffer = HexStringToVal(text)
		for (let i = 0; i < temp.length; i++)
			str = str + String.fromCharCode(temp[i])
		return str
	}
}
