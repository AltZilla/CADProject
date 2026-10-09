import os
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_DIR = os.path.join(BASE_DIR, 'shared', 'python')

shared_files = [
    'classification.py',
    'config.py',
    'dynamo.py',
    'geo_utils.py',
    'models.py'
]

def make_lambda_zip(output_zip_path, handler_path):
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        # 1. Handler at root
        z.write(handler_path, arcname='handler.py')
        
        # 2. Shared files at root
        for sf in shared_files:
            sf_path = os.path.join(SHARED_DIR, sf)
            if os.path.exists(sf_path):
                z.write(sf_path, arcname=sf)
                # Also include inside python/ and shared/python/ for flexible imports
                z.write(sf_path, arcname=f'python/{sf}')
                z.write(sf_path, arcname=f'shared/python/{sf}')
    print(f"Built {output_zip_path} ({os.path.getsize(output_zip_path)} bytes)")

if __name__ == '__main__':
    ingestion_handler = os.path.join(BASE_DIR, 'ingestion', 'handler.py')
    hotspots_handler = os.path.join(BASE_DIR, 'hotspots', 'handler.py')
    
    make_lambda_zip(os.path.join(BASE_DIR, 'ingestion.zip'), ingestion_handler)
    make_lambda_zip(os.path.join(BASE_DIR, 'hotspots.zip'), hotspots_handler)
    print("Done building packages!")
