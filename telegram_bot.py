import os
import logging
import asyncio
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from aiohttp import web

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

class SimpleAlertBot:
    def __init__(self, token: str):
        self.token = token
        self.application = Application.builder().token(token).build()
        self.subscribers = set()  
        self.setup_handlers()

    def setup_handlers(self):
        self.application.add_handler(CommandHandler("start", self.start_command))
        self.application.add_handler(CommandHandler("subscribe", self.subscribe_command))

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "🤖 Бот для уведомлений о транзакциях\n\n"
            "Используйте /subscribe чтобы получать уведомления"
        )

    async def subscribe_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = update.effective_chat.id
        self.subscribers.add(chat_id)
        await update.message.reply_text(
            "✅ Вы подписались на уведомления!\n"
            "Теперь вы будете получать оповещения о подозрительных транзакциях."
        )
        logger.info(f"New subscriber: {chat_id}")

    async def send_alert(self, message: str):
        if not self.subscribers:
            logger.info("No subscribers to notify")
            return

        for chat_id in list(self.subscribers):
            try:
                await self.application.bot.send_message(
                    chat_id=chat_id,
                    text=message
                )
                logger.info(f"Alert sent to {chat_id}")
            except Exception as e:
                logger.error(f"Failed to send to {chat_id}: {e}")
                self.subscribers.remove(chat_id)

    async def handle_alert_request(self, request):
        try:
            data = await request.json()
            message = data.get('message', 'Новое уведомление')
            await self.send_alert(message)
            return web.json_response({"status": "sent"})
        except Exception as e:
            logger.error(f"Error handling alert: {e}")
            return web.json_response({"error": str(e)}, status=400)

    async def run(self):
        app = web.Application()
        app.router.add_post('/alert', self.handle_alert_request)
        
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '0.0.0.0', 8082)
        await site.start()
        
        logger.info("HTTP server started on port 8082")

        await self.application.initialize()
        await self.application.start()
        await self.application.updater.start_polling()
        
        logger.info("Telegram bot started!")

        while True:
            await asyncio.sleep(36)

bot = None

def init_bot(token: str):
    global bot
    bot = SimpleAlertBot(token)
    return bot

def main():
    token = ''
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN environment variable is required!")
        return

    bot = init_bot(token)
    
    try:
        asyncio.run(bot.run())
    except KeyboardInterrupt:
        logger.info("Bot stopped")

if __name__ == '__main__':

    main()
