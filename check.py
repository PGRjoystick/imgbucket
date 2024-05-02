import json

# Load the JSON file
with open('checksums.json') as f:
    data = json.load(f)

# Create a dictionary where the keys are the checksums and the values are lists of file names
checksums = {}
for file_name, checksum in data.items():
    if checksum not in checksums:
        checksums[checksum] = [file_name]
    else:
        checksums[checksum].append(file_name)

# Find and print the duplicates
for checksum, files in checksums.items():
    if len(files) > 1:
        print(f'Duplicate files for checksum {checksum}: {", ".join(files)}')