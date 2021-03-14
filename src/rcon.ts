import protocol from './protocol'
import * as packets from './packet'

class RCON {
    host: string
    port: number
    maxPacketSize: number
    encoding: packets.EncodingOptions
    timeout: number
    connection!: WebSocket
    connected: boolean
    authenticated: boolean

    /**
     * Source RCON (https://developer.valvesoftware.com/wiki/Source_RCON)
     * @param options Connection options
     */
    constructor(options: RCONOptions) {
        this.host = options.host || '127.0.0.1'
        this.port = options.port || 27015
        this.maxPacketSize = options.maxPacketSize || 4096
        this.encoding = options.encoding || 'ascii'
        this.timeout = options.timeout || 1000

        this.authenticated = false
        this.connected = false
        this.connection = new WebSocket(`ws://${this.host}:${this.port}`)
    }

    /**
     * Authenticates the connection
     * @param password Password string
     */
    async authenticate(password: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (this.authenticated) {
                reject(Error('Already authenticated'))
                return
            }

            this.write(protocol.SERVERDATA_AUTH, protocol.ID_AUTH, password)
                .then((data) => {
                    if (data === true) {
                        this.authenticated =  true
                        resolve(true)
                    } else {
                        this.disconnect()
                        reject(Error('Unable to authenticate'))
                    }
                }).catch(reject)
        })
    }

    /**
     * Executes command on the server
     * @param command Command to execute
     */
    execute(command: string): Promise<string | boolean> {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(Error('Already disconnected. Please reauthenticate.'))
                return
            }
            const packetId = Math.floor(Math.random() * (256 - 1) + 1)
            if (!this.connection.send) {
                reject(Error('Unable to write to socket'))
                return
            }

            if (!this.authenticated) {
                reject(Error('Not authorised'))
                return
            }

            this.write(protocol.SERVERDATA_EXECCOMMAND, packetId, command)
                .then(resolve)
                .catch(reject)
        })
    }

    /**
     * Destroys the socket connection
     */
    disconnect(): Promise<void> {
        this.authenticated = false
        this.connected = false
        this.connection.close()

        return new Promise((resolve, reject) => {
            const onError = (e: any): void => {
                this.connection.removeEventListener('close', onClose)
                reject(e)
            }

            const onClose = (): void => {
                this.connection.removeEventListener('error', onError)
                resolve()
            }
        })
    }

    isConnected(): boolean {
        return this.connected
    }

    isAuthenticated(): boolean {
        return this.authenticated
    }

    /**
     * Writes to socket connection
     * @param type Packet Type
     * @param id Packet ID
     * @param body Packet payload
     */
    private write(type: number, id: number, body: string): Promise<string | boolean> {
        return new Promise((resolve, reject) => {

            let response = ''

            const onData = (event: MessageEvent): void => {
                const decodedPacket = packets.decode(event.data, this.encoding)

                // Server will respond twice (0x00 and 0x02) if we send an auth packet (0x03)
                // but we need 0x02 to confirm
                if (type === protocol.SERVERDATA_AUTH && decodedPacket.type !== protocol.SERVERDATA_AUTH_RESPONSE) {
                    return
                } else if (type === protocol.SERVERDATA_AUTH && decodedPacket.type === protocol.SERVERDATA_AUTH_RESPONSE) {
                    if (decodedPacket.id === protocol.ID_AUTH) {
                        resolve(true)
                    } else {
                        resolve(false)
                    }

                    this.connection.removeEventListener('message', onData)
                } else if (id === decodedPacket.id) {
                    response = response.concat(decodedPacket.body.replace(/\n$/, '\n')) // remove last line break

                    // Check the response if it's defined rather than if it contains 'command ${body}'
                    // Reason for this is because we no longer need to check if it starts with 'command', testing shows it never will
                    if (response) {
                        this.connection.removeEventListener('message', onData)
                        resolve(response)
                    }
                }

                this.connection.removeEventListener('error', onError)
            }

            const onError = (e: Event): void => {
                this.connection.removeEventListener('data', onData as EventListener)
                reject(e)
            }

            const encodedPacket = packets.encode(type, id, body, this.encoding)

            if (this.maxPacketSize > 0 && encodedPacket.length > this.maxPacketSize) {
                reject(Error('Packet size too big'))
                return
            }

            if (!this.connection) throw { message: 'Connection not defined'}

            this.connection.onmessage = onData
            this.connection.onerror = onError
            this.connection.send(encodedPacket)
        })
    }
}

interface RCONOptions {
    host?: string
    port?: number
    maxPacketSize?: number
    encoding?: packets.EncodingOptions
    timeout?: number
}

export default RCON
