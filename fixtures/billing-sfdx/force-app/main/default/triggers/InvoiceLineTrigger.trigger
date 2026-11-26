trigger InvoiceLineTrigger on Invoice_Line__c (before insert, before update) {
    class LineTotals {
        Decimal total = 0;

        public void add(Invoice_Line__c line) {
            total += line.Quantity__c * line.Unit_Price__c;
        }
    }

    LineTotals totals = new LineTotals();
    for (Invoice_Line__c line : Trigger.new) {
        if (line.Status__c == null) {
            line.Status__c = 'Open';
        }
        totals.add(line);
    }
}
