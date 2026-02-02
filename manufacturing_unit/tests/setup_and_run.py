
import subprocess
import sys
import logging
import os
import time

# Configure logging
logging.basicConfig(
    filename='res.log',
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    filemode='w'
)
logger = logging.getLogger()

def log(msg):
    print(msg)
    logger.info(msg)

def run_command(cmd):
    log(f"Running: {cmd}")
    try:
        # Capture output to log file
        with open('res.log', 'a') as f:
            subprocess.check_call(cmd, shell=True, stdout=f, stderr=f)
        log("Command success")
    except subprocess.CalledProcessError as e:
        log(f"Command failed with code {e.returncode}")
        return False
    return True

def main():
    log("Starting robustness test...")
    
    # Run integration tests
    if os.path.exists("run_integration_tests.py"):
        run_command(f"{sys.executable} run_integration_tests.py")
    else:
        log("run_integration_tests.py missing")
        
    # Print results file if exists
    if os.path.exists("integration_results.log"):
        log("--- TEST RESULTS ---")
        with open("integration_results.log", "r") as f:
            print(f.read())
        log("--------------------")
    else:
        log("No results log found. Test runner likely crashed.")

if __name__ == "__main__":
    main()
