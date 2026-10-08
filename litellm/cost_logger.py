import os, json, time
from litellm.integrations.custom_logger import CustomLogger

class CostLogger(CustomLogger):
    def record(self, kwargs, response, error=False):
        params = kwargs.get('litellm_params', {})
        metadata = params.get('metadata') or {}
        tags = metadata.get('tags') or kwargs.get('request_tags') or []
        hidden = getattr(response, '_hidden_params', {}) or {}
        usage = getattr(response, 'usage', None)
        if hasattr(usage, 'model_dump'):
            usage = usage.model_dump()
        elif not isinstance(usage, dict):
            usage = {}
        cost = kwargs.get('response_cost', hidden.get('response_cost'))
        entry = {'id': str(kwargs.get('litellm_call_id') or hidden.get('litellm_call_id') or time.time_ns()), 'model': kwargs.get('model'), 'tags': tags, 'metadata': metadata, 'usage': usage, 'costUsd': cost, 'status': 'failed' if error else 'completed', 'time': time.time()}
        target = os.environ.get('COST_LOG_PATH', '.runtime/gateway-costs.jsonl')
        os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
        with open(target, 'a') as f:
            f.write(json.dumps(entry, default=str) + '\n')
    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self.record(kwargs, response_obj)
    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self.record(kwargs, response_obj, True)

proxy_handler_instance = CostLogger()
