from django.apps import AppConfig


class AiservicesConfig(AppConfig):
    name = 'aiservices'

    def ready(self):
        # Register inference auto-propagation signals
        from aiservices.inference.signals import register_signals
        register_signals()
