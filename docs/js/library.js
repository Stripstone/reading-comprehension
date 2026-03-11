// Updated pagination and break logic to ensure clean start/end to each page

function chunkBlocksToPages(blocks, pageSize = 1600) {
    let pages = [];
    let currentPage = '';
    let currentSize = 0;

    blocks.forEach(block => {
        // Split block by sentence terminators first
        let sentences = block.split(/(?<=[.?!])\s+/); // Split by sentence endings
        sentences.forEach(sentence => {
            let sentenceLength = sentence.length;

            if (currentSize + sentenceLength > pageSize) {
                // If adding this sentence exceeds the target size, create a new page
                if (currentPage) {
                    pages.push(currentPage);
                    currentPage = sentence; // Start a new page with the current sentence
                }
                currentSize = sentenceLength; // Reset the page size counter for the new page
            } else {
                // Add sentence to current page
                currentPage += sentence + ' ';
                currentSize += sentenceLength;
            }
        });
    });

    // Push the last page if there's content left
    if (currentPage) {
        pages.push(currentPage);
    }

    return pages;
}

// Adjusted block merging logic
function mergeFragmentedBlocks(blocks) {
    // Add any additional merging logic if needed (i.e., to prevent unnatural breaks)
    return blocks;
}

function cleanImportedBlock(rawText) {
    // Clean unnecessary content like whitespace, tags, etc., as before
    return rawText.replace(/\s+/g, ' ').trim();
}