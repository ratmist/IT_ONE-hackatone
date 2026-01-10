import torch
import logging
from transformers import pipeline, AutoTokenizer


logger = logging.getLogger(__name__)

class MLEngine:
    _instance = None
    
    def __init__(self):
        self.classifiers = {}
        self.logger = logger
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = MLEngine()
        return cls._instance
    
    def load_model(self, model_name):
        if model_name in self.classifiers:
            return self.classifiers[model_name]
        try:
            classifier = pipeline(
                "text-classification",
                model=model_name,
                tokenizer=AutoTokenizer.from_pretrained(model_name),
                device=0 if torch.cuda.is_available() else -1
            )
            self.classifiers[model_name] = classifier
            self.logger.info(f"ML модель {model_name} загружена")
            return classifier
        except Exception as e:
            self.logger.error(f"Ошибка загрузки модели {model_name}: {e}")
            raise
    
    def evaluate_transaction(self, ml_rule, transaction_data):
        if not ml_rule.is_active:
            return False, 0.0, []
        try:
            classifier = self.load_model(ml_rule.model_name)
            transaction_text = self.preprocess_transaction(ml_rule.input_template, transaction_data)
            prediction = classifier(transaction_text, truncation=True, max_length=512)
            fraud_prob = None
            for pred in prediction:
                if pred['label'].lower() in ['fraud', '1', 'positive', 'label_1']:
                    fraud_prob = pred['score']
                    break
            
            if fraud_prob is None:
                fraud_prob = prediction[0]['score']
            
            is_fraud = fraud_prob >= ml_rule.threshold
            triggered_conditions = [f"ML вероятность {fraud_prob:.4f} >= {ml_rule.threshold}"] if is_fraud else []
            
            return is_fraud, fraud_prob, triggered_conditions
            
        except Exception as e:
            self.logger.error(f"Ошибка ML-правила {ml_rule.title}: {e}")
            return False, 0.0, []
    
    def preprocess_transaction(self, template, transaction_data):
        template_vars = {
            'amount': transaction_data.get('amount', 0),
            'sender_account': transaction_data.get('sender_account', 'unknown'),
            'receiver_account': transaction_data.get('receiver_account', 'unknown'),
            'timestamp': transaction_data.get('timestamp', 'unknown'),
            'transaction_type': transaction_data.get('transaction_type', 'unknown'),
            'location': transaction_data.get('location', 'unknown'),
            'merchant_category': transaction_data.get('merchant_category', 'unknown'),
            'device_used': transaction_data.get('device_used', 'unknown'),
            'payment_channel': transaction_data.get('payment_channel', 'unknown')
        }
        try:
            return template.format(**template_vars)
        except KeyError as e:
            self.logger.warning(f"Отсутствует переменная в шаблоне: {e}")
            return (f"Transaction {template_vars['transaction_type']} amount {template_vars['amount']} "
                   f"from {template_vars['sender_account']} to {template_vars['receiver_account']} "
                   f"at {template_vars['timestamp']}")
