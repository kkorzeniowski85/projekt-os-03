from slowapi import Limiter
from slowapi.util import get_remote_address

#: Rate limiting w pamieci procesu. Wystarcza przy jednym procesie uvicorna;
#: przy wielu workerach trzeba podac storage_uri="redis://..." (inaczej limit
#: jest liczony osobno przez kazdy worker).
limiter = Limiter(key_func=get_remote_address, default_limits=[])
